import fs from "fs-extra";
import path from "path";
import { logger } from "../logger.js";
import { notifyMaintenanceIssue } from "../monitoring/alerts.js";

const DEFAULT_MAX_AGE_MS = Number(process.env.CLEANUP_MAX_AGE_MS || 10 * 60 * 1000);
const DEFAULT_DIRECTORIES = (process.env.CLEANUP_DIRECTORIES || "tmp/uploads,tmp/exports")
  .split(",")
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir));

async function removeOldEntries(dir, cutoffTs) {
  const exists = await fs.pathExists(dir);
  if (!exists) {
    return { removed: 0 };
  }

  let removed = 0;
  const items = await fs.readdir(dir);
  await Promise.all(items.map(async (item) => {
    const fullPath = path.join(dir, item);
    try {
      const stat = await fs.stat(fullPath);
      const isDirectory = stat.isDirectory();
      if (isDirectory) {
        const nested = await removeOldEntries(fullPath, cutoffTs);
        removed += nested.removed;
        const stillExists = await fs.pathExists(fullPath);
        if (stillExists) {
          const children = await fs.readdir(fullPath);
          if (children.length === 0) {
            await fs.remove(fullPath);
          }
        }
        return;
      }
      const lastModified = Math.max(stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs);
      if (lastModified < cutoffTs) {
        await fs.remove(fullPath);
        removed += 1;
      }
    } catch (err) {
      logger.warn("cleanup.fs.skipped", { path: fullPath, message: err?.message || String(err) });
    }
  }));

  return { removed };
}

export async function cleanupArtifacts({ directories = DEFAULT_DIRECTORIES, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const cutoffTs = Date.now() - maxAgeMs;
  let filesRemoved = 0;
  for (const dir of directories) {
    const result = await removeOldEntries(dir, cutoffTs);
    filesRemoved += result.removed;
  }
  if (filesRemoved > 0) {
    logger.info("cleanup.files.removed", { count: filesRemoved, maxAgeMs });
  }
  return { filesRemoved };
}

export function startCleanupScheduler({
  manager,
  intervalMs = Number(process.env.CLEANUP_INTERVAL_MS || 60 * 1000),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  directories = DEFAULT_DIRECTORIES,
} = {}) {
  if (!manager) {
    throw new Error("cleanup scheduler requires a job manager instance");
  }

  const execute = async () => {
    try {
      await manager.cleanup({ maxAgeMs });
      await cleanupArtifacts({ directories, maxAgeMs });
    } catch (err) {
      logger.error("cleanup.run.failed", { message: err?.message || String(err) });
      await notifyMaintenanceIssue("cleanup run failed", err);
    }
  };

  // Run immediately to ensure old artifacts are purged on boot.
  execute();

  const timer = setInterval(execute, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
