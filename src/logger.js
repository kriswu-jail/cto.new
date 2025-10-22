const LEVEL_METHOD = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  alert: console.warn,
};

function sanitizeMetadata(metadata = {}) {
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && typeof value !== "function");
  return Object.fromEntries(entries);
}

function log(level, event, metadata = {}) {
  const writer = LEVEL_METHOD[level] || console.log;
  const payload = {
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    event,
    ...sanitizeMetadata(metadata),
  };
  writer(JSON.stringify(payload));
}

export const logger = {
  info(event, metadata) {
    log("info", event, metadata);
  },
  warn(event, metadata) {
    log("warn", event, metadata);
  },
  error(event, metadata) {
    log("error", event, metadata);
  },
  alert(event, metadata) {
    log("alert", event, metadata);
  },
};

export function jobMetadata(job, extra = {}) {
  const durationMs = job.finishedAt && job.startedAt
    ? Math.max(0, job.finishedAt - job.startedAt)
    : undefined;
  return sanitizeMetadata({
    jobId: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    durationMs,
    ...extra,
  });
}
