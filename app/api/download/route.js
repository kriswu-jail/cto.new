import { verifySignedDownloadToken, readFileBuffer } from '../../../lib/tempStorage.js';
import { zh, withApiGuard } from '../../../lib/guard.js';
import { extFromMime } from '../../../lib/mime.js';

export const runtime = 'nodejs';

function jsonError(message, status = 400, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const verified = verifySignedDownloadToken(token);
    if (!verified.ok) {
      return jsonError(zh.invalidToken, 400, { code: 'INVALID_TOKEN' });
    }
    const { key } = verified;
    const data = await readFileBuffer(key);
    if (!data) {
      return jsonError(zh.notFound, 404, { code: 'NOT_FOUND' });
    }

    const { buffer, meta } = data;
    const mime = meta.mimeType || 'application/octet-stream';
    const ext = meta.ext || extFromMime(mime) || 'bin';
    const filename = `artifact.${ext}`;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return jsonError('服务器内部错误，请稍后重试。', 500, { code: 'INTERNAL_ERROR' });
  }
}

export const GET = withApiGuard(handler, { rateLimitPerDay: parseInt(process.env.API_RATE_LIMIT_PER_DAY || '30', 10) });
