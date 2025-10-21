import express from "express";
import path from "path";
import { createDefaultManager } from "./queue/jobManager.js";
import { JSONJobStore } from "./storage/jsonStore.js";
import { AllowedJobTypes } from "./types.js";

const app = express();
app.use(express.json());

const store = process.env.NODE_ENV === "test"
  ? new JSONJobStore({ filePath: path.join(process.cwd(), "tmp", "api-jobs.json") })
  : new JSONJobStore();

const manager = createDefaultManager({
  store,
  concurrency: Number(process.env.JOB_CONCURRENCY || 2),
  rateLimit: process.env.RATE_MAX && process.env.RATE_INTERVAL_MS
    ? { max: Number(process.env.RATE_MAX), intervalMs: Number(process.env.RATE_INTERVAL_MS) }
    : null,
});

app.post("/api/jobs", async (req, res) => {
  try {
    const { type, payload, options } = req.body || {};
    if (!type || !AllowedJobTypes.has(type)) {
      return res.status(400).json({ error: "Invalid or missing job type", allowedTypes: Array.from(AllowedJobTypes) });
    }
    const job = await manager.enqueue({ type, payload, options });
    res.status(202).json({ id: job.id, status: job.status });
  } catch (err) {
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

if (process.env.NODE_ENV !== "test") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Job manager API listening on :${port}`);
  });
}

export default app;
