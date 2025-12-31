const nodemailer = require('nodemailer');
require('dotenv').config();

const emailUser = process.env.EMAIL_USER;
const emailPassRaw = process.env.EMAIL_PASS;
// Gmail "App Password" is often copied with spaces (e.g. "abcd efgh ijkl mnop").
// Nodemailer expects the raw token without whitespace.
const emailPass = typeof emailPassRaw === 'string' ? emailPassRaw.replace(/\s+/g, '') : emailPassRaw;

function parseFrom(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1], email: m[2] };
  return { name: null, email: raw };
}

async function sendViaBrevoApi({ from, to, subject, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not set');

  const senderRaw = process.env.EMAIL_FROM || from || emailUser || '';
  const sender = parseFrom(senderRaw) || { name: null, email: senderRaw };
  if (!sender.email) throw new Error('EMAIL_FROM/EMAIL_USER not set');

  const toEmail = Array.isArray(to) ? to[0] : to;
  const recipient = parseFrom(toEmail)?.email || String(toEmail || '').trim();
  if (!recipient) throw new Error('Recipient email missing');

  const payload = {
    sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) },
    to: [{ email: recipient }],
    subject: String(subject || ''),
    textContent: String(text || ''),
  };

  const timeoutMs = Number(process.env.EMAIL_API_TIMEOUT_MS || 15000);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const textBody = await res.text().catch(() => '');
      throw new Error(`Brevo API error: ${res.status} ${textBody}`.slice(0, 400));
    }
    return { ok: true, provider: 'brevo_api' };
  } finally {
    clearTimeout(t);
  }
}

function buildSmtpTransport() {
  return nodemailer.createTransport({
    // Default to Gmail SMTP. You can override with EMAIL_HOST/EMAIL_PORT/EMAIL_SECURE if needed.
    ...(process.env.EMAIL_HOST
      ? {
          host: process.env.EMAIL_HOST,
          port: Number(process.env.EMAIL_PORT || 587),
          secure: String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true',
        }
      : { service: 'gmail', port: 465, secure: true }),
    auth: {
      user: emailUser,
      pass: emailPass,
    },
    connectionTimeout: Number(process.env.EMAIL_SMTP_CONNECTION_TIMEOUT_MS || 15000),
    greetingTimeout: Number(process.env.EMAIL_SMTP_GREETING_TIMEOUT_MS || 15000),
    socketTimeout: Number(process.env.EMAIL_SMTP_SOCKET_TIMEOUT_MS || 20000),
  });
}

const smtpTransport = buildSmtpTransport();

async function sendMail({ from, to, subject, text }) {
  // On some hosts (including Render), outbound SMTP ports can be blocked or flaky.
  // Prefer Brevo API (HTTPS) when BREVO_API_KEY is present.
  if (process.env.BREVO_API_KEY) return sendViaBrevoApi({ from, to, subject, text });
  return smtpTransport.sendMail({ from, to, subject, text });
}

module.exports = { sendMail };
