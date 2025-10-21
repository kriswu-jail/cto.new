import { nanoid } from "nanoid";
import { JSONJobStore } from "../storage/jsonStore.js";
import { JobStatus, AllowedJobTypes, now } from "../types.js";
import { backoffDelay } from "../utils.js";
import { processors } from "../processors/index.js";

export class JobManager {
  constructor({
    store = new JSONJobStore(),
    concurrency = Number(process.env.JOB_CONCURRENCY || 2),
    rateLimit = null, // { max: number, intervalMs: number }
    baseRetryDelayMs = 200,
    maxRetries = 3,
  } = {}) {
    this.store = store;
    this.concurrency = Math.max(1, concurrency | 0);
    this.rateLimit = rateLimit; // not null if enabled
    this.baseRetryDelayMs = baseRetryDelayMs;
    this.maxRetries = maxRetries;

    this.queue = [];
    this.running = new Map(); // id -> controller
    this.startTimes = []; // timestamps of job starts for rate limiting
    this.startSeq = 0; // monotonic counter for start order

    this.started = false;
  }

  async init() {
    if (this.started) return;
    await this.store.init?.();
    // Re-queue any jobs that were previously queued or running
    const all = await this.store.all();
    const toRequeue = all.filter((j) => [JobStatus.Queued, JobStatus.Running].includes(j.status));
    for (const job of toRequeue) {
      job.status = JobStatus.Queued;
      job.startedAt = null;
      job.finishedAt = null;
      await this.store.update(job);
      this.queue.push(job.id);
    }
    this.started = true;
    this._pump();
  }

  async enqueue({ type, payload = {}, options = {} }) {
    if (!AllowedJobTypes.has(type)) {
      throw new Error(`Unsupported job type: ${type}`);
    }
    const id = nanoid();
    const job = {
      id,
      type,
      payload,
      status: JobStatus.Queued,
      progress: 0,
      message: null,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      maxRetries: options.maxRetries ?? this.maxRetries,
      error: null,
      output: null,
      startIndex: null,
      nextRunAt: null,
    };
    await this.store.add(job);
    this.queue.push(id);
    this._pump();
    return job;
  }

  async getJob(id) {
    return await this.store.get(id);
  }

  async cancelJob(id) {
    const job = await this.store.get(id);
    if (!job) return null;
    if (job.status === JobStatus.Completed || job.status === JobStatus.Failed) return job;
    job.status = JobStatus.Cancelled;
    job.finishedAt = now();
    await this.store.update(job);
    const ctrl = this.running.get(id);
    if (ctrl) {
      ctrl.abort();
      this.running.delete(id);
    } else {
      // Remove from queue if waiting
      const idx = this.queue.indexOf(id);
      if (idx >= 0) this.queue.splice(idx, 1);
    }
    return job;
  }

  async _maybeStartNext() {
    if (this.running.size >= this.concurrency) return false;
    const id = this.queue.shift();
    if (!id) return false;
    const job = await this.store.get(id);
    if (!job) return false;
    if (job.status !== JobStatus.Queued) return false;

    // rate limit guard
    if (this.rateLimit) {
      const nowTs = now();
      const interval = this.rateLimit.intervalMs;
      // clean timestamps older than interval
      this.startTimes = this.startTimes.filter((t) => nowTs - t < interval);
      if (this.startTimes.length >= this.rateLimit.max) {
        // push back to queue and delay
        this.queue.unshift(id);
        const delayMs = (this.startTimes[0] + interval) - nowTs + 1;
        setTimeout(() => this._pump(), Math.max(1, delayMs));
        return false;
      }
      this.startTimes.push(nowTs);
    }

    const ctrl = new AbortController();
    this.running.set(id, ctrl);

    job.status = JobStatus.Running;
    job.startedAt = now();
    job.startIndex = this.startSeq++;
    await this.store.update(job);

    const progressUpdater = (percent, message) => {
      // Avoid decreasing progress
      if (percent > job.progress) {
        job.progress = Math.min(100, Math.max(0, Math.floor(percent)));
      }
      if (message != null) job.message = String(message);
      this.store.update(job); // fire and forget
    };

    const attempt = job.attempts + 1;
    // Persist attempt count immediately so observers see current try number
    job.attempts = attempt;
    await this.store.update(job);

    const run = processors[job.type];

    run(job, { updateProgress: progressUpdater, signal: ctrl.signal, attempt })
      .then(async (result) => {
        if (ctrl.signal.aborted) return; // cancelled
        job.output = result?.output ?? null;
        job.progress = 100;
        job.status = JobStatus.Completed;
        job.finishedAt = now();
        await this.store.update(job);
      })
      .catch(async (err) => {
        if (ctrl.signal.aborted) return;
        // job.attempts already reflects this attempt
        // If transient and attempts < max, schedule retry with backoff
        const isTransient = err?.isTransient || err?.name === "TransientError";
        if (isTransient && attempt <= job.maxRetries) {
          const delay = backoffDelay(this.baseRetryDelayMs, attempt);
          job.status = JobStatus.Queued;
          job.message = err.message || String(err);
          job.error = { message: err.message || String(err), transient: true };
          job.startedAt = null;
          job.finishedAt = null;
          job.nextRunAt = now() + delay;
          await this.store.update(job);
          setTimeout(() => {
            this.queue.push(id);
            this._pump();
          }, delay);
        } else {
          job.status = JobStatus.Failed;
          job.finishedAt = now();
          job.error = { message: err?.message || String(err), transient: !!isTransient };
          await this.store.update(job);
        }
      })
      .finally(() => {
        this.running.delete(id);
        this._pump();
      });

    return true;
  }

  async _pump() {
    // Try to start as many jobs as allowed
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const started = await this._maybeStartNext();
      if (!started) break;
    }
  }
}

export function createDefaultManager(options = {}) {
  const mgr = new JobManager(options);
  mgr.init();
  return mgr;
}
