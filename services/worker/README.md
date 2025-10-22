# Auto-merge Worker

This worker automates the batch merge workflow for the repository. When executed, it:

- Enumerates every open pull request (including those targeting non-`main` bases).
- Attempts to retarget bases to `main` when possible.
- Syncs each head branch with the latest `main`, waiting for CI to complete.
- Performs squash merges for PRs that pass all checks and satisfy repository policies.
- Creates helper branches for unresolved conflicts and leaves contextual comments on PRs.
- Produces a consolidated "批量合并报告" issue summarising successes, failures, and items requiring manual follow-up.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | ✅ | Token with permissions to read/write PRs, push branches, and create issues. (`GH_TOKEN`, `GITHUB_PAT`, or `TOKEN` are also recognized.) |
| `GITHUB_OWNER` | ⛔️ (default: `kriswu-jail`) | Repository owner/organisation. |
| `GITHUB_REPO` | ⛔️ (default: `cto.new`) | Repository name. |
| `MAIN_BRANCH` | ⛔️ (default: `main`) | Target branch for merges. |
| `CI_TIMEOUT_MINUTES` | ⛔️ (default: `30`) | Maximum time to wait for CI to finish after syncing. |
| `CI_POLL_INTERVAL_SECONDS` | ⛔️ (default: `30`) | Polling interval while waiting on CI. |

## Running locally

```bash
pnpm install
pnpm --filter worker start
```

The command expects the environment variables above to be populated. In CI environments, schedule the worker as needed (e.g. via cron or a workflow dispatch).
