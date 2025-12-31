function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createRateLimiter({ windowMs, max, keyPrefix, keyFn, skipFn, onLimit } = {}) {
  const bucket = new Map(); // key -> { count, resetAt }
  const win = toInt(windowMs, 60_000);
  const limit = toInt(max, 60);
  const prefix = String(keyPrefix ?? 'rl');

  function cleanup(now) {
    // Cheap opportunistic cleanup: remove a few expired keys each request.
    let removed = 0;
    for (const [k, v] of bucket) {
      if (v.resetAt <= now) {
        bucket.delete(k);
        removed += 1;
        if (removed >= 50) break;
      }
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    try {
      if (typeof skipFn === 'function' && skipFn(req)) return next();

      const now = Date.now();
      cleanup(now);

      const identity = typeof keyFn === 'function' ? keyFn(req) : req.ip;
      const key = `${prefix}:${identity}:${req.method}:${req.baseUrl}${req.path}`;

      const existing = bucket.get(key);
      if (!existing || existing.resetAt <= now) {
        bucket.set(key, { count: 1, resetAt: now + win });
        return next();
      }

      existing.count += 1;
      if (existing.count <= limit) return next();

      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      if (typeof onLimit === 'function') return onLimit(req, res, { retryAfterSeconds, limit });
      return res.status(429).json({ error: 'Too many requests', retry_after_seconds: retryAfterSeconds });
    } catch (err) {
      // Fail open.
      return next();
    }
  };
}

module.exports = { createRateLimiter };
