import { withApiGuard, zh } from '../../../lib/guard.js';
import { ALLOWED_MIME_TYPES } from '../../../lib/mime.js';
import { saveTempFile, createSignedDownloadToken } from '../../../lib/tempStorage.js';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function jsonError(message, status = 400, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function handler(req) {
  if (req.method !== 'POST') {
    return jsonError('仅支持 POST 方法。', 405);
  }
  let formData;
  try {
    formData = await req.formData();
  } catch (e) {
    return jsonError('请求体解析失败，请使用 multipart/form-data。', 400, { code: 'BAD_MULTIPART' });
  }

  const files = [];
  for (const [key, val] of formData.entries()) {
    if (typeof val === 'object' && typeof val.arrayBuffer === 'function') {
      files.push(val);
    }
  }

  if (files.length === 0) {
    return jsonError(zh.noFiles, 400, { code: 'NO_FILES' });
  }

  const results = [];

  for (const file of files) {
    const mime = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return jsonError(`${zh.mimeNotAllowed} 仅支持：${Array.from(ALLOWED_MIME_TYPES).join(', ')}`, 400, { code: 'MIME_NOT_ALLOWED', mime });
    }
    if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
      return jsonError(zh.fileTooLarge, 400, { code: 'FILE_TOO_LARGE', maxBytes: MAX_FILE_SIZE });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_FILE_SIZE) {
      return jsonError(zh.fileTooLarge, 400, { code: 'FILE_TOO_LARGE', maxBytes: MAX_FILE_SIZE });
    }

    try {
      const meta = await saveTempFile({
        buffer: buf,
        originalName: file.name,
        mimeType: file.type,
        ttlMs: DEFAULT_TTL_MS,
      });
      const token = createSignedDownloadToken({ key: meta.key, expiresInSeconds: 3600 });
      results.push({
        jobToken: meta.key,
        size: meta.size,
        mimeType: meta.mimeType,
        // Provide a signed download URL path; client can call GET /api/download?token=...
        download: {
          token,
          url: `/api/download?token=${encodeURIComponent(token)}`,
          expiresInSeconds: 3600,
        },
        expireAt: meta.expireAt,
      });
    } catch (e) {
      return jsonError('文件保存失败。', 500, { code: 'SAVE_FAILED' });
    }
  }

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST = withApiGuard(handler, { rateLimitPerDay: parseInt(process.env.API_RATE_LIMIT_PER_DAY || '30', 10) });
