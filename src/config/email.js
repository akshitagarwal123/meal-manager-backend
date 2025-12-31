const nodemailer = require('nodemailer');
require('dotenv').config();

const emailUser = process.env.EMAIL_USER;
const emailPassRaw = process.env.EMAIL_PASS;
// Gmail "App Password" is often copied with spaces (e.g. "abcd efgh ijkl mnop").
// Nodemailer expects the raw token without whitespace.
const emailPass = typeof emailPassRaw === 'string' ? emailPassRaw.replace(/\s+/g, '') : emailPassRaw;

const transporter = nodemailer.createTransport({
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
});

module.exports = transporter;
