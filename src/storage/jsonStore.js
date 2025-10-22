import fs from "fs-extra";
import path from "path";
import { JobStatus } from "../types.js";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_FILE = path.join(DEFAULT_DATA_DIR, "jobs.json");

const TERMINAL_STATUSES = new Set([
  JobStatus.Completed,
  JobStatus.Failed,
  JobStatus.Cancelled,
  JobStatus.TimedOut,
]);

export class JSONJobStore {
  constructor({ filePath = DEFAULT_FILE } = {}) {
    this.filePath = filePath;
    this.initialized = false;
    this.jobs = new Map();
  }

  async init() {
    if (this.initialized) return;
    await fs.ensureDir(path.dirname(this.filePath));
    if (await fs.pathExists(this.filePath)) {
      const content = await fs.readFile(this.filePath, "utf8");
      try {
        const data = JSON.parse(content || "{}");
        if (data && typeof data === "object") {
          const entries = Object.entries(data);
          this.jobs = new Map(entries);
        }
      } catch (_) {}
    } else {
      await fs.writeFile(this.filePath, "{}", "utf8");
    }
    this.initialized = true;
  }

  async save() {
    const obj = Object.fromEntries(this.jobs);
    await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), "utf8");
  }

  async add(job) {
    await this.init();
    this.jobs.set(job.id, job);
    await this.save();
    return job;
  }

  async update(job) {
    await this.init();
    this.jobs.set(job.id, job);
    await this.save();
    return job;
  }

  async get(id) {
    await this.init();
    return this.jobs.get(id) || null;
  }

  async delete(id) {
    await this.init();
    const existed = this.jobs.delete(id);
    await this.save();
    return existed;
  }

  async all() {
    await this.init();
    return Array.from(this.jobs.values());
  }

  async removeOlderThan(cutoffTs) {
    await this.init();
    const removed = [];
    for (const [id, job] of this.jobs.entries()) {
      if (!TERMINAL_STATUSES.has(job.status)) continue;
      const referenceTs = job.finishedAt ?? job.createdAt ?? 0;
      if (!referenceTs) continue;
      if (referenceTs < cutoffTs) {
        this.jobs.delete(id);
        removed.push(job);
      }
    }
    if (removed.length > 0) {
      await this.save();
    }
    return removed;
  }
}
