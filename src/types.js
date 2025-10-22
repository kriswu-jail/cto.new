export const JobTypes = Object.freeze({
  Convert: "转PDF/PNG",
  OCR: "OCR",
  BatchClean: "批量清洗",
  Zip: "Zip处理",
});

export const AllowedJobTypes = new Set(Object.values(JobTypes));

export const JobStatus = Object.freeze({
  Queued: "queued",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Cancelled: "cancelled",
  TimedOut: "timed_out",
});

export class TransientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TransientError";
    this.isTransient = true;
    this.cause = options.cause;
  }
}

export function now() {
  return Date.now();
}
