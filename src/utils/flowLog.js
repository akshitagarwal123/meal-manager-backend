function shouldFlowLog() {
  const v = String(process.env.LOG_FLOW ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off';
}

function shouldLogSensitive() {
  return String(process.env.LOG_SENSITIVE ?? 'false').toLowerCase() === 'true';
}

function mask(value, { showStart = 4, showEnd = 2 } = {}) {
  const s = String(value ?? '');
  if (shouldLogSensitive()) return s;
  if (s.length <= showStart + showEnd) return '***';
  return `${s.slice(0, showStart)}***${s.slice(-showEnd)}`;
}

function safeStringify(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatFields(fields) {
  if (!fields || typeof fields !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const keyLower = String(k).toLowerCase();
    if (keyLower.includes('otp') || keyLower.includes('token') || k === 'deviceToken' || k === 'device_token') {
      parts.push(`${k}=${mask(v)}`);
    } else {
      parts.push(`${k}=${safeStringify(v)}`);
    }
  }
  return parts.length ? `: ${parts.join(', ')}` : '';
}

function flowLog(tag, message, fields) {
  if (!shouldFlowLog()) return;
  console.log(`[${tag}] ${message}${formatFields(fields)}`);
}

module.exports = { flowLog, mask };
