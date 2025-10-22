export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function backoffDelay(baseMs, attempt, { factor = 2, max = 10000, jitter = true } = {}) {
  const raw = Math.min(baseMs * Math.pow(factor, attempt - 1), max);
  if (!jitter) return raw;
  const rand = Math.random() * raw * 0.3; // up to 30% jitter
  return Math.floor(raw - raw * 0.15 + rand);
}
