import { logger, jobMetadata } from "../logger.js";

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;

async function sendWebhook(payload) {
  if (!ALERT_WEBHOOK_URL) {
    logger.info("alerts.webhook.skipped", { reason: "missing ALERT_WEBHOOK_URL", event: payload.event });
    return;
  }
  if (typeof fetch !== "function") {
    logger.warn("alerts.webhook.unsupported", { event: payload.event });
    return;
  }
  try {
    const res = await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook responded with ${res.status}`);
    }
    logger.info("alerts.webhook.delivered", { event: payload.event });
  } catch (err) {
    logger.error("alerts.webhook.failed", {
      event: payload.event,
      message: err?.message || String(err),
    });
  }
}

export async function notifyJobFailure(job, error) {
  const metadata = jobMetadata(job, {
    event: "job_failure",
    error: error?.message || String(error),
    transient: Boolean(error?.isTransient || error?.name === "TransientError"),
  });
  logger.alert("alerts.job.failure", metadata);
  await sendWebhook({ event: "job_failure", payload: metadata });
}

export async function notifyJobTimeout(job, timeoutMs) {
  const metadata = jobMetadata(job, {
    event: "job_timeout",
    timeoutMs,
  });
  logger.alert("alerts.job.timeout", metadata);
  await sendWebhook({ event: "job_timeout", payload: metadata });
}

export async function notifyMaintenanceIssue(message, error) {
  const payload = {
    event: "maintenance_issue",
    message,
    error: error?.message || String(error),
  };
  logger.error("alerts.maintenance", payload);
  await sendWebhook({ event: "maintenance_issue", payload });
}
