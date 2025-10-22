import { nanoid } from "nanoid";
import { JSONJobStore } from "../storage/jsonStore.js";
import { JobStatus, AllowedJobTypes, now } from "../types.js";
import { backoffDelay } from "../utils.js";
import { processors } from "../processors/index.js";
import { logger as defaultLogger, jobMetadata } from "../logger.js";
import { notifyJobFailure, notifyJobTimeout } from "../monitoring/alerts.js";

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 10;
const DEFAULT_CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 5);
const DEFAULT_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS || 2 * 60 * 1000);
const DEFAULT_CLEANUP_MAX_AGE_MS = Number(process.env.JOB_MAX_AGE_MS || 10 * 60 * 1000);

const TERMINAL_STATUSES = new Set([
  JobStatus.Completed,
  JobStatus.Failed,
  JobStatus.Cancelled,
  JobStatus.TimedOut,
]);

export class JobManager {
  constructor({
    store = new JSONJobStore(),
    concurrency = DEFAULT_CONCURRENCY,
    rateLimit = null, // { max: number, intervalMs: number }
    baseRetryDelayMs = 200,
    maxRetries = 3,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    cleanupMaxAgeMs = DEFAULT_CLEANUP_MAX_AGE_MS,
    logger = defaultLogger,
  } = {}) {
    this.store = store;
    const normalizedConcurrency = Number.isFinite(concurrency) ? Math.trunc(concurrency) : DEFAULT_CONCURRENCY;
    const clampedConcurrency = Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, normalizedConcurrency || DEFAULT_CONCURRENCY));
    this.concurrency = clampedConcurrency;
    this.rateLimit = rateLimit; // not null if enabled
    this.baseRetryDelayMs = baseRetryDelayMs;
    this.maxRetries = maxRetries;
    this.defaultTimeoutMs = Math.max(0, Number.isFinite(defaultTimeoutMs) ? defaultTimeoutMs : DEFAULT_TIMEOUT_MS);
    this.cleanupMaxAgeMs = Math.max(1, Number.isFinite(cleanupMaxAgeMs) ? cleanupMaxAgeMs : DEFAULT_CLEANUP_MAX_AGE_MS);
    this.logger = logger;

    this.queue = [];
    this.running = new Map(); // id -> { controller, timeoutId }
    this.startTimes = []; // timestamps of job starts for rate limiting
    this.startSeq = 0; // monotonic counter for start order

    this.started = false;

    if (clampedConcurrency !== normalizedConcurrency) {
      this.logger.warn("jobs.concurrency.clamped", {
        requested: normalizedConcurrency,
        effective: clampedConcurrency,
        max: MAX_CONCURRENCY,
      });
    }
  }

  async init() {
    if (this.started) return;
    await this.store.init?.();
    const all = await this.store.all();
    const toRequeue = all.filter((j) => [JobStatus.Queued, JobStatus.Running].includes(j.status));
    for (const job of toRequeue) {
      job.status = JobStatus.Queued;
      job.startedAt = null;
      job.finishedAt = null;
      job.error = null;
      job.message = null;
      await this.store.update(job);
      this.queue.push(job.id);
    }
    this.started = true;
    if (toRequeue.length > 0) {
      this.logger.info("jobs.requeued", { count: toRequeue.length });
    }
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
      timeoutMs: options.timeoutMs && Number.isFinite(options.timeoutMs)
        ? Math.max(0, options.timeoutMs)
        : null,
    };
    await this.store.add(job);
    this.queue.push(id);
    this.logger.info("jobs.enqueued", { jobId: job.id, type: job.type });
    this._pump();
    return job;
  }

  async getJob(id) {
    return await this.store.get(id);
  }

  async cancelJob(id) {
    const job = await this.store.get(id);
    if (!job) return null;
    if (TERMINAL_STATUSES.has(job.status)) return job;
    job.status = JobStatus.Cancelled;
    job.finishedAt = now();
    job.message = "Cancelled by user";
    await this.store.update(job);
    const runningEntry = this._clearRunning(id);
    if (runningEntry) {
      runningEntry.controller.abort();
    } else {
      const idx = this.queue.indexOf(id);
      if (idx >= 0) this.queue.splice(idx, 1);
    }
    this.logger.warn("jobs.cancelled", jobMetadata(job, { reason: "manual" }));
    return job;
  }

  _resolveTimeout(job) {
    const candidate = job.timeoutMs ?? this.defaultTimeoutMs;
    if (!candidate || !Number.isFinite(candidate) || candidate <= 0) return 0;
    return candidate;
  }

  _clearRunning(id) {
    const entry = this.running.get(id);
    if (!entry) return null;
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.running.delete(id);
    return entry;
  }

  async _handleTimeout(id, timeoutMs) {
    const entry = this.running.get(id);
    if (!entry) return;
    entry.controller.abort();
    this._clearRunning(id);
    const job = await this.store.get(id);
    if (!job || job.status !== JobStatus.Running) {
      return;
    }
    job.status = JobStatus.TimedOut;
    job.finishedAt = now();
    job.message = `Timed out after ${timeoutMs}ms`;
    job.error = { message: "Timed out", timeoutMs };
    await this.store.update(job);
    this.logger.warn("jobs.timeout", jobMetadata(job, { timeoutMs }));
    await notifyJobTimeout(job, timeoutMs);
    this._pump();
  }

  async _maybeStartNext() {
    if (this.running.size >= this.concurrency) return false;
    const id = this.queue.shift();
    if (!id) return false;
    const job = await this.store.get(id);
    if (!job) return false;
    if (job.status !== JobStatus.Queued) return false;

    if (this.rateLimit) {
      const nowTs = now();
      const interval = this.rateLimit.intervalMs;
      this.startTimes = this.startTimes.filter((t) => nowTs - t < interval);
      if (this.startTimes.length >= this.rateLimit.max) {
        this.queue.unshift(id);
        const delayMs = (this.startTimes[0] + interval) - nowTs + 1;
        setTimeout(() => this._pump(), Math.max(1, delayMs));
        return false;
      }
      this.startTimes.push(nowTs);
    }

    const controller = new AbortController();
    const runningEntry = { controller, timeoutId: null };
    this.running.set(id, runningEntry);

    job.status = JobStatus.Running;
    job.startedAt = now();
    job.startIndex = this.startSeq++;
    job.message = "Running";
    await this.store.update(job);

    const progressUpdater = (percent, message) => {
      if (percent > job.progress) {
        job.progress = Math.min(100, Math.max(0, Math.floor(percent)));
      }
      if (message != null) job.message = String(message);
      this.store.update(job);
    };

    const attempt = job.attempts + 1;
    job.attempts = attempt;
    await this.store.update(job);

    const timeoutMs = this._resolveTimeout(job);
    if (timeoutMs > 0) {
      runningEntry.timeoutId = setTimeout(() => this._handleTimeout(id, timeoutMs), timeoutMs);
    }

    this.logger.info("jobs.started", jobMetadata(job, { attempt, timeoutMs: timeoutMs || undefined }));

    const run = processors[job.type];

    run(job, { updateProgress: progressUpdater, signal: controller.signal, attempt })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        job.output = result?.output ?? null;
        job.progress = 100;
        job.status = JobStatus.Completed;
        job.finishedAt = now();
        job.message = "Completed";
        await this.store.update(job);
        this.logger.info("jobs.completed", jobMetadata(job));
      })
      .catch(async (err) => {
        if (controller.signal.aborted) return;
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
          this.logger.warn("jobs.retry.scheduled", jobMetadata(job, { delayMs: delay }));
          setTimeout(() => {
            this.queue.push(id);
            this._pump();
          }, delay);
        } else {
          job.status = JobStatus.Failed;
          job.finishedAt = now();
          job.error = { message: err?.message || String(err), transient: !!isTransient };
          await this.store.update(job);
          this.logger.error("jobs.failed", jobMetadata(job, {
            error: err?.message || String(err),
            transient: !!isTransient,
          }));
          await notifyJobFailure(job, err);
        }
      })
      .finally(() => {
        this._clearRunning(id);
        this._pump();
      });

    return true;
  }

  async _pump() {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const started = await this._maybeStartNext();
      if (!started) break;
    }
  }

  async cleanup({ maxAgeMs = this.cleanupMaxAgeMs } = {}) {
    const cutoffTs = now() - maxAgeMs;
    const removed = await this.store.removeOlderThan(cutoffTs);
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((job) => job.id));
      this.queue = this.queue.filter((queuedId) => !removedIds.has(queuedId));
      for (const id of removedIds) {
        this._clearRunning(id);
      }
      this.logger.info("jobs.cleanup.store", { count: removed.length, maxAgeMs });
    }

    const allJobs = await this.store.all();
    const knownIds = new Set(allJobs.map((job) => job.id));
    const beforeQueueLength = this.queue.length;
    this.queue = this.queue.filter((id) => knownIds.has(id));
    if (this.queue.length !== beforeQueueLength) {
      this.logger.warn("jobs.cleanup.queue_pruned", {
        removed: beforeQueueLength - this.queue.length,
      });
    }
    for (const [id] of this.running) {
      if (!knownIds.has(id)) {
        this._clearRunning(id);
      }
    }

    return { removedJobs: removed.length };
  }

  async getStats() {
    const jobs = await this.store.all();
    const counts = {
      [JobStatus.Queued]: 0,
      [JobStatus.Running]: 0,
      [JobStatus.Completed]: 0,
      [JobStatus.Failed]: 0,
      [JobStatus.Cancelled]: 0,
      [JobStatus.TimedOut]: 0,
    };
    let oldestCreatedAt = null;
    for (const job of jobs) {
      if (counts[job.status] !== undefined) {
        counts[job.status] += 1;
      }
      if (job.createdAt != null) {
        oldestCreatedAt = oldestCreatedAt == null ? job.createdAt : Math.min(oldestCreatedAt, job.createdAt);
      }
    }
    return {
      concurrency: this.concurrency,
      running: this.running.size,
      queueDepth: this.queue.length,
      totalJobs: jobs.length,
      counts,
      oldestJobCreatedAt: oldestCreatedAt,
      rateLimit: this.rateLimit,
      started: this.started,
    };
  }
}

export function createDefaultManager(options = {}) {
  const mgr = new JobManager(options);
  mgr.init();
  return mgr;
}
