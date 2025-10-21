import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomId, hmacSign, timingSafeEqual, nowSeconds } from './utils.js';
import { extFromMime } from './mime.js';

const BASE_DIR = process.env.TEMP_STORAGE_DIR || path.join(process.cwd(), 'storage', 'temp');
const SECRET = process.env.SIGNED_URL_SECRET || 'dev-secret-change-me';

async function ensureBaseDir() {
  await fsp.mkdir(BASE_DIR, { recursive: true });
}

function metaPath(key) {
  return path.join(BASE_DIR, `${key}.json`);
}

function filePathForKey(key, ext = 'bin') {
  return path.join(BASE_DIR, `${key}.${ext}`);
}

export async function cleanupExpired() {
  await ensureBaseDir();
  const entries = await fsp.readdir(BASE_DIR);
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const metaFile = path.join(BASE_DIR, entry);
    try {
      const meta = JSON.parse((await fsp.readFile(metaFile)).toString('utf8'));
      if (meta && meta.expireAt && now >= meta.expireAt) {
        const key = entry.slice(0, -5);
        const ext = meta.ext || 'bin';
        const p = filePathForKey(key, ext);
        await Promise.allSettled([
          fsp.unlink(metaFile),
          fsp.unlink(p).catch(() => {}),
        ]);
      }
    } catch (e) {
      // ignore corrupt
    }
  }
}

export async function saveTempFile({ buffer, originalName, mimeType, ttlMs = 24 * 60 * 60 * 1000 }) {
  await ensureBaseDir();
  await cleanupExpired();
  const key = randomId(12);
  const ext = (originalName && path.extname(originalName).slice(1)) || extFromMime(mimeType) || 'bin';
  const filePath = filePathForKey(key, ext);
  await fsp.writeFile(filePath, buffer);
  const now = Date.now();
  const meta = {
    key,
    filePath,
    ext,
    size: buffer.length,
    mimeType: mimeType || 'application/octet-stream',
    originalName: originalName || null,
    createdAt: now,
    expireAt: now + ttlMs,
  };
  await fsp.writeFile(metaPath(key), JSON.stringify(meta, null, 2));
  return meta;
}

export async function getMeta(key) {
  try {
    const meta = JSON.parse((await fsp.readFile(metaPath(key))).toString('utf8'));
    return meta;
  } catch {
    return null;
  }
}

export async function readFileBuffer(key) {
  const meta = await getMeta(key);
  if (!meta) return null;
  try {
    const buf = await fsp.readFile(filePathForKey(key, meta.ext || 'bin'));
    return { buffer: buf, meta };
  } catch {
    return null;
  }
}

export function createSignedDownloadToken({ key, expiresInSeconds = 3600 }) {
  const exp = nowSeconds() + Math.max(1, expiresInSeconds);
  const payload = `${key}.${exp}`;
  const sig = hmacSign(payload, SECRET);
  return `${key}.${exp}.${sig}`;
}

export function verifySignedDownloadToken(token) {
  if (!token) return { ok: false, error: 'MISSING' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'FORMAT' };
  const [key, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!exp || nowSeconds() >= exp) return { ok: false, error: 'EXPIRED' };
  const expected = hmacSign(`${key}.${exp}`, SECRET);
  if (!timingSafeEqual(expected, sig)) return { ok: false, error: 'SIG' };
  return { ok: true, key, exp };
}
