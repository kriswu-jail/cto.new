import { TransientError } from "../types.js";
import { sleep } from "../utils.js";

// Simulated processors for allowed job types.
// Each processor receives (job, { updateProgress, signal }) and should call updateProgress(percent, message)
// and respect signal.aborted to stop early.

async function runSteps({ steps = 5, delayMs = 50, failOnce = false }, ctx) {
  const { updateProgress, signal, attempt } = ctx;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) return;
    await sleep(delayMs);
    if (signal.aborted) return;
    const percent = Math.floor((i / steps) * 100);
    updateProgress(percent, `Step ${i}/${steps}`);
    if (failOnce && attempt === 1 && i === Math.ceil(steps / 2)) {
      throw new TransientError("Transient failure, please retry");
    }
  }
}

export const processors = {
  "转PDF/PNG": async (job, ctx) => {
    const opts = job.payload || {};
    await runSteps({ steps: 6, delayMs: opts.delayMs ?? 40, failOnce: opts.failOnce }, ctx);
    return { output: { format: "pdf/png" } };
  },
  OCR: async (job, ctx) => {
    const opts = job.payload || {};
    await runSteps({ steps: 4, delayMs: opts.delayMs ?? 60, failOnce: opts.failOnce }, ctx);
    return { output: { text: "recognized text" } };
  },
  "批量清洗": async (job, ctx) => {
    const opts = job.payload || {};
    await runSteps({ steps: 8, delayMs: opts.delayMs ?? 30, failOnce: opts.failOnce }, ctx);
    return { output: { cleaned: true } };
  },
  "Zip处理": async (job, ctx) => {
    const opts = job.payload || {};
    await runSteps({ steps: 5, delayMs: opts.delayMs ?? 50, failOnce: opts.failOnce }, ctx);
    return { output: { archive: true } };
  },
};
