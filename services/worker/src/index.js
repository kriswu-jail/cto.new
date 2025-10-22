import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

const EnhancedOctokit = Octokit.plugin(retry, throttling);

const token =
  process.env.GITHUB_TOKEN ??
  process.env.GH_TOKEN ??
  process.env.GITHUB_PAT ??
  process.env.TOKEN;

if (!token) {
  console.error(
    "Missing GitHub token. Please set GITHUB_TOKEN (or GH_TOKEN/GITHUB_PAT/TOKEN).",
  );
  process.exit(1);
}

const owner =
  process.env.GITHUB_OWNER ??
  process.env.REPO_OWNER ??
  process.env.OWNER ??
  "kriswu-jail";
const repo = process.env.GITHUB_REPO ?? process.env.REPO_NAME ?? process.env.REPO ?? "cto.new";
const mainBranch = process.env.MAIN_BRANCH ?? "main";
const ciTimeoutMinutes = Number.parseInt(process.env.CI_TIMEOUT_MINUTES ?? "30", 10);
const ciPollIntervalSeconds = Number.parseInt(
  process.env.CI_POLL_INTERVAL_SECONDS ?? "30",
  10,
);

const config = {
  owner,
  repo,
  mainBranch,
  ci: {
    timeoutMs: Number.isNaN(ciTimeoutMinutes) ? 30 * 60 * 1000 : ciTimeoutMinutes * 60 * 1000,
    pollIntervalMs: Number.isNaN(ciPollIntervalSeconds)
      ? 30 * 1000
      : ciPollIntervalSeconds * 1000,
  },
};

const octokit = new EnhancedOctokit({
  auth: token,
  userAgent: "cto.new-auto-merge-worker/1.0.0",
  throttle: {
    onRateLimit(retryAfter, options, octokitInstance, retryCount) {
      octokitInstance.log.warn(
        `Rate limit hit for ${options.method} ${options.url}; retrying in ${retryAfter} seconds.`,
      );
      if (retryCount < 3) {
        return true;
      }
      return false;
    },
    onSecondaryRateLimit(retryAfter, options, octokitInstance, retryCount) {
      octokitInstance.log.warn(
        `Secondary rate limit encountered for ${options.method} ${options.url}; retrying in ${retryAfter} seconds.`,
      );
      if (retryCount < 3) {
        return true;
      }
      return false;
    },
  },
  retry: {
    doNotRetry: ["400", "401", "403", "404"],
  },
});

const prUrl = (number) => `https://github.com/${owner}/${repo}/pull/${number}`;

const statusCategories = {
  merged: "merged",
  failed: "failed",
  skipped: "skipped",
  manual: "manual",
};

const failureCheckConclusions = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
]);

async function main() {
  console.log(
    `Starting batch auto-merge for ${owner}/${repo}; targeting branch ${mainBranch}.`,
  );
  const pullRequests = await listOpenPullRequests();

  if (!pullRequests.length) {
    console.log("No open pull requests detected. Nothing to do.");
    return;
  }

  const results = [];

  for (const initialPr of pullRequests) {
    const result = await processPullRequest(initialPr.number);
    results.push(result);
  }

  await createReportIssue(results);
  console.log("Batch auto-merge flow completed.");
}

async function listOpenPullRequests() {
  const pulls = await octokit.paginate("GET /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    state: "open",
    per_page: 100,
    sort: "updated",
    direction: "asc",
  });
  return pulls;
}

async function processPullRequest(number) {
  const context = {
    number,
    status: statusCategories.skipped,
    notes: [],
    reason: "尚未处理",
  };

  const log = (...args) => console.log(`[PR #${number}]`, ...args);

  try {
    let pr = await waitForMergeable(number);
    context.title = pr.title;
    context.url = pr.html_url;

    log(`Processing PR targeting ${pr.base.ref} from ${pr.head.ref}.`);

    if (pr.state !== "open") {
      context.status = statusCategories.skipped;
      context.reason = "PR 已关闭";
      return context;
    }

    if (pr.draft) {
      context.status = statusCategories.manual;
      context.reason = "PR 处于 Draft 状态";
      await leaveComment(
        number,
        [
          "自动合并机器人跳过此 PR：目前处于 Draft 状态。",
          "如需自动合并，请将 PR 标记为 Ready for review。",
        ].join("\n"),
      );
      return context;
    }

    if (pr.base.ref !== mainBranch) {
      if (pr.mergeable !== true) {
        context.status = statusCategories.manual;
        context.reason = `当前 base (${pr.base.ref}) 上存在冲突，无法自动重定向到 ${mainBranch}`;
        await leaveComment(
          number,
          [
            `自动合并机器人未能将 base 分支从 ${pr.base.ref} 修改为 ${mainBranch}：` +
              "与当前 base 存在冲突，需要人工确认。",
          ].join("\n"),
        );
        return context;
      }

      const previousBase = pr.base.ref;
      const retargetResult = await retargetBase(pr);
      if (!retargetResult.ok) {
        context.status = retargetResult.status;
        context.reason = retargetResult.reason;
        return context;
      }

      log(`Base retargeted from ${previousBase} to ${mainBranch}.`);
      context.notes.push(`已将 base 从 ${previousBase} 调整为 ${mainBranch}`);
      pr = await waitForMergeable(number);
    }

    if (pr.mergeable_state === "blocked") {
      context.status = statusCategories.manual;
      context.reason = "PR 受保护策略阻塞（需要审查/检查）。";
      await leaveComment(
        number,
        [
          "自动合并机器人无法继续：该 PR 当前被保护策略阻塞（例如仍需审查或检查未通过）。",
          "请人工处理后再次触发自动合并。",
        ].join("\n"),
      );
      return context;
    }

    if (pr.mergeable_state === "dirty") {
      context.status = statusCategories.manual;
      context.reason = "PR 与 base 存在冲突。";
      await handleConflict(pr, context, "GitHub 标记为存在冲突。");
      return context;
    }

    const headRepoFullName = pr.head.repo?.full_name;
    const repoFullName = `${owner}/${repo}`;

    if (!headRepoFullName || headRepoFullName !== repoFullName) {
      context.status = statusCategories.manual;
      context.reason = "PR 来自 fork，无法自动更新分支。";
      await leaveComment(
        number,
        [
          "自动合并机器人无法自动更新 fork 仓库的分支。",
          "请手动同步 main 后重新触发 CI，或在 fork 仓库中启用维护者修改权限。",
        ].join("\n"),
      );
      return context;
    }

    const syncResult = await syncWithMain(pr);
    if (syncResult.status === "conflict") {
      context.status = statusCategories.manual;
      context.reason = "将 main 合并到分支时产生冲突。";
      await handleConflict(pr, context, syncResult.message);
      return context;
    }

    if (syncResult.status === "forbidden") {
      context.status = statusCategories.failed;
      context.reason = syncResult.message;
      await leaveComment(
        number,
        [
          "自动合并机器人无法更新该分支：",
          syncResult.message,
          "请确认分支保护或权限设置后再试。",
        ].join("\n"),
      );
      return context;
    }

    if (syncResult.status === "updated") {
      context.notes.push("已同步最新 main");
      log(`Branch updated with latest ${mainBranch} (commit ${syncResult.sha}).`);
    } else {
      log("Branch already up to date with main.");
    }

    pr = await waitForMergeable(number);
    const currentSha = pr.head.sha;

    const ciResult = await waitForCiStatus(currentSha);
    if (ciResult.outcome === "failure") {
      context.status = statusCategories.failed;
      context.reason = ciResult.summary;
      await leaveComment(
        number,
        [
          "自动合并机器人在等待 CI 时发现失败：",
          ...ciResult.details.map((detail) => `- ${detail}`),
          "修复失败项后可重新运行自动合并。",
        ].join("\n"),
      );
      return context;
    }

    if (ciResult.outcome === "timeout") {
      context.status = statusCategories.failed;
      context.reason = "等待 CI 超时";
      await leaveComment(
        number,
        [
          "自动合并机器人在 30 分钟内未等到 CI 完成，已跳过。",
          "请确认流水线状态后再试。",
        ].join("\n"),
      );
      return context;
    }

    pr = await waitForMergeable(number);

    if (pr.mergeable !== true || pr.mergeable_state === "dirty") {
      context.status = statusCategories.manual;
      context.reason = "CI 完成后仍不可自动合并。";
      await handleConflict(pr, context, "CI 完成后 GitHub 标记为不可合并。");
      return context;
    }

    const mergeResult = await mergePullRequest(pr);
    if (!mergeResult.ok) {
      context.status = statusCategories.failed;
      context.reason = mergeResult.reason;
      await leaveComment(
        number,
        [
          "自动合并机器人未能完成合并：",
          mergeResult.reason,
          "请人工介入处理。",
        ].join("\n"),
      );
      return context;
    }

    context.status = statusCategories.merged;
    context.reason = `已 squash 合并，合并提交 ${mergeResult.sha}`;
    if (mergeResult.branchDeleted) {
      context.notes.push("已删除源分支");
    }
    log(`Successfully merged via squash (commit ${mergeResult.sha}).`);
    return context;
  } catch (error) {
    const message = formatError(error);
    console.error(`[PR #${number}] Unexpected error: ${message}`);
    context.status = statusCategories.failed;
    context.reason = `自动化异常：${message}`;
    await leaveComment(
      number,
      [
        "自动合并机器人遇到未处理的异常，已停止自动处理该 PR。",
        `错误信息：${message}`,
      ].join("\n"),
    );
    return context;
  }
}

async function waitForMergeable(number, timeoutMs = 60_000) {
  const start = Date.now();
  let pr;
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const response = await octokit.pulls.get({ owner, repo, pull_number: number });
    pr = response.data;
    if (pr.mergeable !== null) {
      return pr;
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(2000);
  }
  throw new Error("等待 GitHub 计算 mergeable 状态超时");
}

async function retargetBase(pr) {
  const previousBase = pr.base.ref;
  try {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      base: mainBranch,
    });
    return { ok: true };
  } catch (error) {
    const message = formatError(error);
    await leaveComment(
      pr.number,
      [
        "自动合并机器人尝试将 base 重定向到 main 失败：",
        message,
        "请人工确认后再试。",
      ].join("\n"),
    );
    return {
      ok: false,
      status: statusCategories.manual,
      reason: `无法将 base ${previousBase} 重定向到 ${mainBranch}：${message}`,
    };
  }
}

async function syncWithMain(pr) {
  try {
    const response = await octokit.repos.merge({
      owner,
      repo,
      base: pr.head.ref,
      head: mainBranch,
      commit_message: `chore: sync ${mainBranch} into ${pr.head.ref} (#${pr.number})`,
    });
    if (response.status === 201) {
      return { status: "updated", sha: response.data.sha };
    }
    return { status: "noop" };
  } catch (error) {
    if (error.status === 409) {
      return { status: "conflict", message: "与 main 合并时存在冲突" };
    }

    if (error.status === 403) {
      return {
        status: "forbidden",
        message: "缺少更新该分支的权限或分支受保护。",
      };
    }

    throw error;
  }
}

async function waitForCiStatus(sha) {
  const started = Date.now();
  while (Date.now() - started < config.ci.timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const status = await evaluateCiStatus(sha);
    if (status.state === "success") {
      return { outcome: "success", details: [] };
    }
    if (status.state === "failure") {
      return { outcome: "failure", summary: status.summary, details: status.details };
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(config.ci.pollIntervalMs);
  }
  return { outcome: "timeout", details: [] };
}

async function evaluateCiStatus(sha) {
  const [combinedStatusResponse, checksResponse] = await Promise.allSettled([
    octokit.repos.getCombinedStatusForRef({ owner, repo, ref: sha }),
    octokit.checks.listForRef({ owner, repo, ref: sha, per_page: 100 }),
  ]);

  const failures = [];
  const pending = [];

  if (combinedStatusResponse.status === "fulfilled") {
    const combined = combinedStatusResponse.value.data;
    for (const status of combined.statuses) {
      if (status.state === "failure" || status.state === "error") {
        failures.push(`${status.context} (${status.state})`);
      } else if (status.state === "pending" || status.state === "expected") {
        pending.push(status.context);
      }
    }
  }

  if (checksResponse.status === "fulfilled") {
    for (const run of checksResponse.value.data.check_runs) {
      if (run.status !== "completed") {
        pending.push(run.name);
        continue;
      }
      if (run.conclusion && failureCheckConclusions.has(run.conclusion)) {
        failures.push(`${run.name} (${run.conclusion})`);
      }
    }
  }

  if (failures.length > 0) {
    return {
      state: "failure",
      summary: `CI 失败：${failures.join(", ")}`,
      details: failures,
    };
  }

  if (pending.length === 0) {
    return { state: "success", details: [] };
  }

  return { state: "pending", details: pending };
}

async function mergePullRequest(pr) {
  try {
    const response = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pr.number,
      sha: pr.head.sha,
      merge_method: "squash",
    });

    const branchDeleted = await deleteSourceBranch(pr);

    return { ok: true, sha: response.data.sha, branchDeleted };
  } catch (error) {
    if (error.status === 405) {
      return { ok: false, reason: "仓库策略禁止 squash 合并。" };
    }

    if (error.status === 409) {
      return { ok: false, reason: "GitHub 拒绝合并，可能是分支未最新或审批不足。" };
    }

    return { ok: false, reason: formatError(error) };
  }
}

async function deleteSourceBranch(pr) {
  if (pr.head.repo?.full_name !== `${owner}/${repo}`) {
    return false;
  }

  if (pr.head.ref === mainBranch) {
    return false;
  }

  const branchRef = `heads/${pr.head.ref}`;
  try {
    await octokit.git.deleteRef({ owner, repo, ref: branchRef });
    return true;
  } catch (error) {
    if (error.status === 422 || error.status === 404) {
      return false;
    }
    console.warn(`Failed to delete source branch ${branchRef}: ${formatError(error)}`);
    return false;
  }
}

async function handleConflict(pr, context, reason) {
  if (pr.head.repo?.full_name !== `${owner}/${repo}`) {
    await leaveComment(
      pr.number,
      [
        "自动合并机器人检测到与 main 的冲突，但这是来自 fork 的分支，无法创建修复分支。",
        "请在 fork 仓库中手动解决冲突。",
      ].join("\n"),
    );
    return;
  }

  const conflictBranch = `ci/auto-merge/${pr.number}`;
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${conflictBranch}`,
      sha: pr.head.sha,
    });
    context.notes.push(`已创建冲突修复分支 ${conflictBranch}`);
  } catch (error) {
    if (error.status !== 422) {
      console.warn(
        `Failed to create conflict branch ${conflictBranch}: ${formatError(error)}`,
      );
    } else {
      context.notes.push(`冲突修复分支 ${conflictBranch} 已存在`);
    }
  }

  await leaveComment(
    pr.number,
    [
      "自动合并机器人在尝试同步 main 时遇到冲突，已创建辅助分支：",
      `- 分支：${conflictBranch}`,
      "请在该分支或原分支中手动解决冲突并重新运行 CI。",
      `原因：${reason}`,
    ].join("\n"),
  );
}

async function leaveComment(number, body) {
  try {
    await octokit.issues.createComment({ owner, repo, issue_number: number, body });
  } catch (error) {
    console.warn(`Failed to comment on PR #${number}: ${formatError(error)}`);
  }
}

async function createReportIssue(results) {
  const succeeded = results.filter((item) => item.status === statusCategories.merged);
  const failedOrSkipped = results.filter(
    (item) =>
      item.status === statusCategories.failed || item.status === statusCategories.skipped,
  );
  const manual = results.filter((item) => item.status === statusCategories.manual);

  const formatSection = (title, items) => {
    if (!items.length) {
      return `## ${title}\n- 无`;
    }
    const lines = items.map((item) => {
      const details = [];
      if (item.reason) {
        details.push(item.reason);
      }
      if (item.notes?.length) {
        details.push(...item.notes);
      }
      const suffix = details.length ? ` — ${details.join("；")}` : "";
      return `- [#${item.number}](${item.url ?? prUrl(item.number)}) ${item.title ?? ""}${suffix}`;
    });
    return [`## ${title}`, ...lines].join("\n");
  };

  const timestamp = new Date().toISOString().replace(/T/, " ").replace(/\.\d+Z$/, " UTC");
  const issueTitle = `批量合并报告 - ${timestamp}`;
  const bodySections = [
    `> 自动生成于 ${timestamp}`,
    formatSection("成功合并", succeeded),
    formatSection("失败 / 跳过", failedOrSkipped),
    formatSection("需要人工处理", manual),
  ];

  try {
    await octokit.issues.create({
      owner,
      repo,
      title: issueTitle,
      body: bodySections.join("\n\n"),
    });
  } catch (error) {
    console.error(`Failed to create report issue: ${formatError(error)}`);
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

await main();
