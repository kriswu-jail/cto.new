import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMIT = 30; // per day
const DATA_DIR = process.env.RATE_LIMIT_DIR || path.join(process.cwd(), 'storage');
const DB_PATH = path.join(DATA_DIR, 'ratelimit.json');

async function ensureDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readDb() {
  await ensureDir();
  try {
    const buf = await fsp.readFile(DB_PATH);
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    return {};
  }
}

async function writeDb(db) {
  await ensureDir();
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function nextResetAt() {
  // reset in 24 hours from now
  return Date.now() + 24 * 60 * 60 * 1000;
}

export async function checkAndIncrement(ip, limit = DEFAULT_LIMIT) {
  const db = await readDb();
  const entry = db[ip] || { count: 0, resetAt: nextResetAt() };
  const now = Date.now();
  if (!entry.resetAt || now >= entry.resetAt) {
    entry.count = 0;
    entry.resetAt = nextResetAt();
  }
  if (entry.count >= limit) {
    db[ip] = entry;
    await writeDb(db);
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count += 1;
  db[ip] = entry;
  await writeDb(db);
  return { allowed: true, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

export function getIpFromRequest(req) {
  // Prefer X-Forwarded-For, then CF-Connecting-IP, then x-real-ip, then connection remote address if available
  const headers = req.headers || new Headers();
  const xff = headers.get ? headers.get('x-forwarded-for') : (headers['x-forwarded-for'] || '');
  const cf = headers.get ? headers.get('cf-connecting-ip') : (headers['cf-connecting-ip'] || '');
  const xri = headers.get ? headers.get('x-real-ip') : (headers['x-real-ip'] || '');
  const ip = (xff || '').split(',')[0].trim() || (cf || '').trim() || (xri || '').trim();
  return ip || '0.0.0.0';
}
