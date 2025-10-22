import type { Request, Response, NextFunction } from 'express';

type Key = string;

interface Counter {
  count: number;
  windowStart: number;
}

const counters = new Map<Key, Counter>();

export const createRateLimiter = (options: { windowMs: number; max: number }) => {
  const windowMs = options.windowMs;
  const max = options.max;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const existing = counters.get(key);
    if (!existing || now - existing.windowStart > windowMs) {
      counters.set(key, { count: 1, windowStart: now });
      next();
      return;
    }
    if (existing.count >= max) {
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    existing.count += 1;
    next();
  };
};
