import { checkAndIncrement, getIpFromRequest } from './rateLimit.js';

const DEFAULT_LIMIT = parseInt(process.env.API_RATE_LIMIT_PER_DAY || '30', 10);
const MAX_BODY_SIZE_BYTES = parseInt(process.env.API_MAX_BODY_SIZE_BYTES || String(25 * 1024 * 1024), 10);

function jsonError(message, status = 400, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function withApiGuard(handler, { rateLimitPerDay = DEFAULT_LIMIT, maxBodySizeBytes = MAX_BODY_SIZE_BYTES } = {}) {
  return async function guarded(req, context) {
    try {
      const ip = getIpFromRequest(req);
      const { allowed, remaining, resetAt } = await checkAndIncrement(ip, rateLimitPerDay);
      if (!allowed) {
        return jsonError('请求过于频繁：你已达到今日请求上限，请明天再试。', 429, { code: 'RATE_LIMIT', remaining, resetAt });
      }

      const cl = req.headers.get('content-length');
      if (cl && Number(cl) > maxBodySizeBytes) {
        return jsonError('请求体过大：超过大小限制。', 413, { code: 'BODY_TOO_LARGE' });
      }

      // Continue to handler
      return await handler(req, context);
    } catch (e) {
      return jsonError('服务器内部错误，请稍后重试。', 500, { code: 'INTERNAL_ERROR' });
    }
  };
}

export const zh = {
  noFiles: '未收到任何文件。',
  fileTooLarge: '文件过大：单个文件不能超过20MB。',
  mimeNotAllowed: '不允许的文件类型。',
  invalidToken: '下载链接无效或已过期。',
  notFound: '资源不存在或已过期。',
};
