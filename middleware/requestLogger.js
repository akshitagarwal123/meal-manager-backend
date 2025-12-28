const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

function makeRequestId(req) {
  const incoming = req.headers['x-request-id'];
  if (incoming) return String(incoming);
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldLog() {
  const v = String(process.env.LOG_REQUESTS ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off';
}

function safeKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).slice(0, 20);
}

function requestLogger(req, res, next) {
  if (!shouldLog()) return next();

  const mode = String(process.env.LOG_REQUESTS ?? 'summary').toLowerCase(); // summary | json | true
  const requestId = makeRequestId(req);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  req.log = createLogger({ request_id: requestId });

  // Optional hook for routes to add a short plain-English summary.
  req.setLogSummary = (text, fields = {}) => {
    req._logSummary = { text: String(text || ''), fields: fields || {} };
  };

  // Capture response body for better error summaries (avoid logging full payloads).
  res.locals._responseBody = undefined;
  const originalJson = res.json.bind(res);
  res.json = body => {
    res.locals._responseBody = body;
    return originalJson(body);
  };

  const start = Date.now();
  if (mode === 'json' || mode === 'true') {
    console.log(
      '[REQ]',
      JSON.stringify({
        id: requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        ua: req.headers['user-agent'],
      })
    );
  }

  res.on('finish', () => {
    const ms = Date.now() - start;
    const user = req.user ? { id: req.user.id, role: req.user.role, email: req.user.email } : null;
    if (mode === 'json' || mode === 'true') {
      console.log('[RES]', JSON.stringify({ id: requestId, status: res.statusCode, ms, user }));
      return;
    }

    // Default: one plain-English line per request.
    const who = user ? `${user.role} ${user.email || user.id}` : 'anonymous';
    const summary = req._logSummary?.text ? ` | ${req._logSummary.text}` : '';

    let errorHint = '';
    if (res.statusCode >= 400 && res.locals._responseBody && typeof res.locals._responseBody === 'object') {
      const err = res.locals._responseBody.error || res.locals._responseBody.message;
      if (err) errorHint = ` | error: ${String(err)}`;
    }

    const keyInfo = (() => {
      const q = safeKeys(req.query);
      const b = safeKeys(req.body);
      if (q.length === 0 && b.length === 0) return '';
      return ` | query_keys=[${q.join(',')}] body_keys=[${b.join(',')}]`;
    })();

    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${ms}ms (${who})${summary}${errorHint}${keyInfo} [${requestId}]`);
  });

  next();
}

module.exports = requestLogger;
