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

function formatFields(fields) {
  if (!fields || typeof fields !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (k === 'otp' || k === 'token' || k === 'deviceToken' || k === 'device_token') {
      parts.push(`${k}=${mask(v)}`);
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.length ? `: ${parts.join(', ')}` : '';
}

function flowLog(tag, message, fields) {
  if (!shouldFlowLog()) return;
  console.log(`[${tag}] ${message}${formatFields(fields)}`);
}

module.exports = { flowLog, mask };

