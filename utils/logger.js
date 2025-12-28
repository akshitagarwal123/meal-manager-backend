function levelToNum(level) {
  switch (String(level || '').toLowerCase()) {
    case 'debug':
      return 10;
    case 'info':
      return 20;
    case 'warn':
      return 30;
    case 'error':
      return 40;
    default:
      return 20;
  }
}

function getConfiguredLevel() {
  return levelToNum(process.env.LOG_LEVEL || 'info');
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ note: 'unserializable_log_payload' });
  }
}

function createLogger(base = {}) {
  const min = getConfiguredLevel();
  const flowEnabled = String(process.env.LOG_FLOW_JSON ?? 'false').toLowerCase() === 'true';

  function emit(level, msg, fields) {
    const lvlNum = levelToNum(level);
    if (lvlNum < min) return;
    // By default, only show warnings/errors for step-by-step ("flow") logs.
    if (!flowEnabled && lvlNum < 30) return;
    const payload = { level, msg, ...base, ...(fields || {}) };
    // Single JSON line for easy filtering in terminal/log aggregators.
    const prefix = lvlNum >= 40 ? '[ERROR]' : lvlNum >= 30 ? '[WARN]' : '[INFO]';
    console.log(prefix, safeStringify(payload));
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

module.exports = { createLogger };
