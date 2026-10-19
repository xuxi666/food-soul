const buckets = new Map();

/**
 * 轻量内存限流（单进程）。用于登录/注册、连接测试、配置保存与模型调用。
 * @param {import('node:http').IncomingMessage} req
 * @param {string} scope
 * @param {number} limit
 * @param {number} windowMs
 */
export function rateLimit(req, scope, limit = 10, windowMs = 60_000) {
  const ip =
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const key = `${scope}:${ip}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.start >= windowMs) buckets.delete(k);
    }
  }

  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000)),
  };
}
