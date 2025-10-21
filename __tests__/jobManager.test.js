import { JSONJobStore } from "../src/storage/jsonStore.js";
import { JobManager } from "../src/queue/jobManager.js";
import { JobTypes, JobStatus } from "../src/types.js";
import path from "path";
import fs from "fs-extra";

function tmpStore(name) {
  const filePath = path.join(process.cwd(), "tmp", `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  return new JSONJobStore({ filePath });
}

async function createManager(options = {}) {
  const store = tmpStore("jobs");
  const mgr = new JobManager({ store, ...options });
  await mgr.init();
  return mgr;
}

async function waitForJobDone(mgr, id, { timeoutMs = 10000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await mgr.getJob(id);
    if ([JobStatus.Completed, JobStatus.Failed, JobStatus.Cancelled].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout waiting job done");
}

describe("JobManager", () => {
  afterAll(async () => {
    await fs.remove(path.join(process.cwd(), "tmp"));
  });

  test("processes jobs in enqueue order with concurrency=1", async () => {
    const mgr = await createManager({ concurrency: 1 });
    const j1 = await mgr.enqueue({ type: JobTypes.OCR, payload: { delayMs: 10 } });
    const j2 = await mgr.enqueue({ type: JobTypes.OCR, payload: { delayMs: 10 } });
    const j3 = await mgr.enqueue({ type: JobTypes.OCR, payload: { delayMs: 10 } });

    const [r1, r2, r3] = await Promise.all([
      waitForJobDone(mgr, j1.id),
      waitForJobDone(mgr, j2.id),
      waitForJobDone(mgr, j3.id),
    ]);

    expect(r1.status).toBe(JobStatus.Completed);
    expect(r2.status).toBe(JobStatus.Completed);
    expect(r3.status).toBe(JobStatus.Completed);

    // Ensure startIndex increases in the same order of enqueue
    expect(r1.startIndex).toBeLessThan(r2.startIndex);
    expect(r2.startIndex).toBeLessThan(r3.startIndex);
  });

  test("rate limiting spaces job starts even with higher concurrency", async () => {
    const mgr = await createManager({ concurrency: 3, rateLimit: { max: 1, intervalMs: 120 } });
    const j1 = await mgr.enqueue({ type: JobTypes.Convert, payload: { delayMs: 30 } });
    const j2 = await mgr.enqueue({ type: JobTypes.Convert, payload: { delayMs: 30 } });
    const j3 = await mgr.enqueue({ type: JobTypes.Convert, payload: { delayMs: 30 } });

    const [r1, r2, r3] = await Promise.all([
      waitForJobDone(mgr, j1.id),
      waitForJobDone(mgr, j2.id),
      waitForJobDone(mgr, j3.id),
    ]);

    const jobs = [r1, r2, r3].sort((a, b) => a.startIndex - b.startIndex);
    const t1 = jobs[0].startedAt;
    const t2 = jobs[1].startedAt;
    const t3 = jobs[2].startedAt;

    // Allow some tolerance for timers
    expect(t2 - t1).toBeGreaterThanOrEqual(90);
    expect(t3 - t2).toBeGreaterThanOrEqual(90);
  });

  test("transient failure is retried with backoff and then succeeds", async () => {
    const mgr = await createManager({ concurrency: 1, baseRetryDelayMs: 50, maxRetries: 3 });
    const job = await mgr.enqueue({ type: JobTypes.Zip, payload: { delayMs: 20, failOnce: true }, options: { maxRetries: 2 } });

    const final = await waitForJobDone(mgr, job.id);
    expect(final.status).toBe(JobStatus.Completed);
    expect(final.attempts).toBeGreaterThanOrEqual(2);
    expect(final.output).toBeTruthy();
  });

  test("cancel stops a running job", async () => {
    const mgr = await createManager({ concurrency: 1 });
    const job = await mgr.enqueue({ type: JobTypes.BatchClean, payload: { delayMs: 50 } });
    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 40));
    await mgr.cancelJob(job.id);
    const final = await waitForJobDone(mgr, job.id);
    expect([JobStatus.Cancelled, JobStatus.Completed]).toContain(final.status);
    // Ideally cancelled
    expect(final.status).toBe(JobStatus.Cancelled);
  });
});
