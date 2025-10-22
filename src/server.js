import express from "express";
import path from "path";
import { createDefaultManager } from "./queue/jobManager.js";
import { JSONJobStore } from "./storage/jsonStore.js";
import { AllowedJobTypes } from "./types.js";
import { startCleanupScheduler } from "./maintenance/cleanup.js";
import { logger } from "./logger.js";
import { notifyMaintenanceIssue } from "./monitoring/alerts.js";

const app = express();
app.use(express.json());

const store = process.env.NODE_ENV === "test"
  ? new JSONJobStore({ filePath: path.join(process.cwd(), "tmp", "api-jobs.json") })
  : new JSONJobStore();

const manager = createDefaultManager({
  store,
  concurrency: Number(process.env.JOB_CONCURRENCY || 5),
  rateLimit: process.env.RATE_MAX && process.env.RATE_INTERVAL_MS
    ? { max: Number(process.env.RATE_MAX), intervalMs: Number(process.env.RATE_INTERVAL_MS) }
    : null,
  defaultTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || 2 * 60 * 1000),
  cleanupMaxAgeMs: Number(process.env.JOB_MAX_AGE_MS || 10 * 60 * 1000),
});

app.locals.jobManager = manager;

if (process.env.NODE_ENV !== "test") {
  const stopCleanup = startCleanupScheduler({ manager });
  app.locals.stopCleanup = stopCleanup;
  logger.info("service.startup", { message: "Cleanup scheduler initialized" });
}

app.post("/api/jobs", async (req, res) => {
  try {
    const { type, payload, options } = req.body || {};
    if (!type || !AllowedJobTypes.has(type)) {
      return res.status(400).json({ error: "Invalid or missing job type", allowedTypes: Array.from(AllowedJobTypes) });
    }
    const job = await manager.enqueue({ type, payload, options });
    res.status(202).json({ id: job.id, status: job.status });
  } catch (err) {
    logger.error("http.jobs.enqueue_failed", { message: err?.message || String(err) });
    await notifyMaintenanceIssue("job enqueue failed", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await manager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    attempts: job.attempts,
    maxRetries: job.maxRetries,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    nextRunAt: job.nextRunAt,
    output: job.output,
  });
});

app.delete("/api/jobs/:id", async (req, res) => {
  const job = await manager.cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json({ id: job.id, status: job.status });
});

app.get("/health", async (_req, res) => {
  const stats = await manager.getStats();
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    queue: {
      running: stats.running,
      depth: stats.queueDepth,
      concurrency: stats.concurrency,
    },
  });
});

app.get(["/status", "/healthz"], async (_req, res) => {
  const stats = await manager.getStats();
  res.json({
    ...stats,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use(async (err, req, res, _next) => {
  logger.error("http.unhandled", {
    method: req.method,
    path: req.path,
    message: err?.message || String(err),
  });
  await notifyMaintenanceIssue(`Unhandled error on ${req.method} ${req.path}`, err);
  res.status(500).json({ error: "Internal Server Error" });
});

if (process.env.NODE_ENV !== "test") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info("service.listening", { port: Number(port) });
  });
}

export default app;
