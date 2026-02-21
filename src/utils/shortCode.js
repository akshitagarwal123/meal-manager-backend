const crypto = require('crypto');

function normalizePasscode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

function getTimeStep(ttlSeconds, atEpochSeconds = Math.floor(Date.now() / 1000)) {
  const ttl = Number(ttlSeconds || 30);
  return Math.floor(atEpochSeconds / (ttl > 0 ? ttl : 30));
}

function generateShortCode({ userId, secret, step }) {
  const hmac = crypto.createHmac('sha256', String(secret));
  hmac.update(`${Number(userId)}:${Number(step)}`);
  const digest = hmac.digest();

  // HOTP-style truncation for uniform 6-digit codes.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

function getCandidateSteps({ ttlSeconds, leewaySeconds = 10, nowEpochSeconds = Math.floor(Date.now() / 1000) }) {
  const ttl = Number(ttlSeconds || 30) || 30;
  const leeway = Number(leewaySeconds || 0) || 0;
  const current = getTimeStep(ttl, nowEpochSeconds);
  const skewSteps = Math.max(1, Math.ceil(leeway / ttl));
  const steps = [];
  for (let i = current - skewSteps; i <= current + skewSteps; i += 1) {
    steps.push(i);
  }
  return steps;
}

module.exports = {
  normalizePasscode,
  getTimeStep,
  generateShortCode,
  getCandidateSteps,
};
