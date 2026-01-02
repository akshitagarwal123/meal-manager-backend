const jwt = require('jsonwebtoken');
const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const mailer = require('../config/email');
const { getISTDateString } = require('../utils/date');
const { writeAuditLog, getReqMeta } = require('../utils/audit');
const { flowLog, mask } = require('../utils/flowLog');
const authenticateToken = require('../middleware/authenticateToken');
const { createRateLimiter } = require('../middleware/rateLimit');
const { respondServerError, shouldExposeErrors } = require('../utils/http');

const router = express.Router();

// Simple in-memory throttles (for multi-instance production, prefer a shared store like Redis).
const limitAuthExist = createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'auth:user-exists' });
const limitSendOtp = createRateLimiter({ windowMs: 10 * 60_000, max: 5, keyPrefix: 'auth:send-otp' });
const limitVerifyOtp = createRateLimiter({ windowMs: 10 * 60_000, max: 10, keyPrefix: 'auth:verify-otp' });
const limitSaveDetails = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'auth:save-details' });

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed) return false;
  // Pragmatic validation (avoid overly strict RFC rules).
  if (trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
}

function shouldReturnDevOtp() {
  return !isProduction() && process.env.RETURN_DEV_OTP === 'true';
}

function hashOtp({ email, otp }) {
  const secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('OTP hash secret missing (set OTP_HASH_SECRET or JWT_SECRET)');
  return crypto.createHmac('sha256', secret).update(`${String(email).toLowerCase()}:${String(otp)}`).digest('hex');
}

function signAppToken({ userRow, hostelId }) {
  return jwt.sign(
    {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
      college_id: userRow.college_id ?? null,
      hostel_id: hostelId ?? null,
      // Used for single-device student login enforcement (see authenticateToken).
      token_version: typeof userRow.token_version === 'number' ? userRow.token_version : undefined,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function saveOtpToAuditLog({ email, otp, expiresAt }) {
  await pool.query(
    `INSERT INTO audit_logs (college_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES (NULL, NULL, $1, $2, $3, $4::jsonb)`,
    ['OTP_GENERATED', 'login_otp', email, JSON.stringify({ otp_hash: hashOtp({ email, otp }), expires_at: expiresAt.toISOString() })]
  );
}

async function verifyOtpFromAuditLog({ email, otp }) {
  const result = await pool.query(
    `SELECT details, created_at
     FROM audit_logs
     WHERE entity_type = 'login_otp' AND entity_id = $1 AND action = 'OTP_GENERATED'
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  );
  if (result.rows.length === 0) return { ok: false, reason: 'not_found' };

  const details = result.rows[0].details || {};
  const storedOtpHash = String(details.otp_hash || '');
  const storedOtp = String(details.otp || '');
  const expiresAt = details.expires_at ? new Date(details.expires_at) : null;
  if (storedOtpHash) {
    const incomingHash = hashOtp({ email, otp });
    if (storedOtpHash.length !== incomingHash.length) return { ok: false, reason: 'mismatch' };
    const a = Buffer.from(storedOtpHash, 'hex');
    const b = Buffer.from(incomingHash, 'hex');
    if (a.length !== b.length || a.length === 0) return { ok: false, reason: 'mismatch' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  } else {
    if (!storedOtp || storedOtp !== String(otp)) return { ok: false, reason: 'mismatch' };
  }
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  await pool.query(
    `INSERT INTO audit_logs (college_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES (NULL, NULL, $1, $2, $3, $4::jsonb)`,
    ['OTP_VERIFIED', 'login_otp', email, JSON.stringify({ verified_at: new Date().toISOString() })]
  );

  return { ok: true };
}

async function getActiveHostelAssignment({ userId, date }) {
  const result = await pool.query(
    `SELECT hostel_id
     FROM user_hostel_assignments
     WHERE user_id = $1
       AND start_date <= $2
       AND (end_date IS NULL OR end_date >= $2)
     ORDER BY start_date DESC
     LIMIT 1`,
    [userId, date]
  );
  return result.rows?.[0]?.hostel_id ?? null;
}

async function getActiveManagerHostel({ userId, date }) {
  const result = await pool.query(
    `SELECT hostel_id
     FROM hostel_staff
     WHERE user_id = $1
       AND start_date <= $2
       AND (end_date IS NULL OR end_date >= $2)
     ORDER BY start_date DESC
     LIMIT 1`,
    [userId, date]
  );
  return result.rows?.[0]?.hostel_id ?? null;
}

// Quick check used by frontend to validate an email before OTP flow.
// POST /auth/user-exists  { "email": "user@example.com" }
router.post('/user-exists', limitAuthExist, async (req, res) => {
  const email = req.body?.email;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });

  const normalized = String(email).trim().toLowerCase();

  try {
    flowLog('USER EXISTS', 'Request received', { email: normalized });
    const result = await pool.query('SELECT id, role FROM users WHERE email = $1 LIMIT 1', [normalized]);
    const row = result.rows?.[0];

    await writeAuditLog({
      action: 'AUTH_USER_EXISTS',
      entityType: 'user',
      entityId: normalized,
      details: { ...getReqMeta(req), exists: Boolean(row), role: row?.role ?? null },
    });

    if (!row) return res.json({ exists: false });
    return res.json({ exists: true, user_id: row.id, role: row.role });
  } catch (err) {
    await writeAuditLog({
      action: 'AUTH_USER_EXISTS_ERROR',
      entityType: 'user',
      entityId: normalized,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Send OTP to email (stored in audit_logs.details for verification).
router.post('/send-otp', limitSendOtp, async (req, res) => {
  const email = req.body?.email;
  if (!isValidEmail(email)) {
    flowLog('SEND OTP', 'Request rejected (missing email)');
    req.log?.info('auth.send_otp.rejected', { reason: 'email_required' });
    await writeAuditLog({
      action: 'AUTH_SEND_OTP_REJECTED',
      entityType: 'login_otp',
      entityId: 'missing_email',
      details: { ...getReqMeta(req), reason: 'email_required' },
    });
    req.setLogSummary?.('OTP request rejected (missing email)');
    return res.status(400).json({ error: 'Invalid email' });
  }

  flowLog('SEND OTP', 'Request received', { email });
  req.log?.info('auth.send_otp.start', { email });
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  try {
    // Only allow OTP for users that already exist in DB.
    const userRes = await pool.query('SELECT id, is_active, college_id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (userRes.rows.length === 0) {
      flowLog('SEND OTP', 'User not found', { email });
      req.log?.info('auth.send_otp.rejected', { email, reason: 'user_not_found' });
      await writeAuditLog({
        action: 'AUTH_SEND_OTP_REJECTED',
        entityType: 'login_otp',
        entityId: email,
        details: { ...getReqMeta(req), reason: 'user_not_found' },
      });
      req.setLogSummary?.('OTP request rejected (user not found)', { email });
      return res.status(404).json({ error: 'User not found' });
    }
    if (userRes.rows[0].is_active === false) {
      flowLog('SEND OTP', 'User inactive', { email });
      req.log?.info('auth.send_otp.rejected', { email, reason: 'user_inactive' });
      await writeAuditLog({
        collegeId: userRes.rows[0].college_id ?? null,
        actorUserId: userRes.rows[0].id,
        action: 'AUTH_SEND_OTP_REJECTED',
        entityType: 'login_otp',
        entityId: email,
        details: { ...getReqMeta(req), reason: 'user_inactive' },
      });
      req.setLogSummary?.('OTP request rejected (user inactive)', { email });
      return res.status(403).json({ error: 'User is inactive' });
    }
    const actorUserId = userRes.rows[0].id;
    const collegeId = userRes.rows[0].college_id ?? null;

    await saveOtpToAuditLog({ email, otp, expiresAt });
    flowLog('SEND OTP', 'OTP stored in DB', { email, otp: mask(otp) });
    await writeAuditLog({
      collegeId,
      actorUserId,
      action: 'AUTH_SEND_OTP',
      entityType: 'login_otp',
      entityId: email,
      details: { ...getReqMeta(req), expires_at: expiresAt.toISOString() },
    });
    req.log?.info('auth.send_otp.audit_saved', { email, actor_user_id: actorUserId, expires_at: expiresAt.toISOString() });

    const provider = process.env.BREVO_API_KEY ? 'brevo_api' : process.env.EMAIL_HOST ? 'smtp' : 'gmail';
    flowLog('SEND OTP', 'Email provider selected', { provider });
    req.log?.info('auth.send_otp.email_provider', { email, provider });

    const mailPromise = mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP for Count Wise',
      text: `Your OTP is ${otp}. It is valid for 5 minutes.`,
    });
    req.log?.info('auth.send_otp.email_sending', { email });

    const timeoutMs = Number(process.env.OTP_EMAIL_TIMEOUT_MS || 15000);
    await Promise.race([
      mailPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OTP email timeout')), timeoutMs)),
    ]);

    flowLog('SEND OTP', 'Email sent', { email });
    req.log?.info('auth.send_otp.email_sent', { email });
    req.setLogSummary?.('OTP generated and email sent', { email });
    const responseBody = { success: true, message: 'OTP sent to email' };
    if (shouldReturnDevOtp()) responseBody.dev_otp = otp;
    flowLog('SEND OTP', 'Response', { success: responseBody.success, message: responseBody.message });
    return res.json(responseBody);
  } catch (err) {
    const details = err?.message || String(err);
    flowLog('SEND OTP', 'Failed', { email, error: details });
    req.log?.warn('auth.send_otp.error', { email, error: details });
    req.setLogSummary?.('OTP send failed', { email });
    await writeAuditLog({
      action: 'AUTH_SEND_OTP_ERROR',
      entityType: 'login_otp',
      entityId: email,
      details: { ...getReqMeta(req), error: details },
    });

    const allowFallback = !isProduction() && (process.env.ALLOW_DEV_OTP === 'true' || process.env.NODE_ENV !== 'prod');

    if (allowFallback) {
      return res.json({
        success: true,
        message: 'OTP generated (email delivery unavailable on this network)',
        otp,
        emailDelivery: 'failed',
        ...(shouldExposeErrors() ? { details } : {}),
      });
    }

    return res.status(500).json({ error: 'Failed to send OTP', ...(shouldExposeErrors() ? { details } : {}) });
  }
});

// Verify OTP, return token if user exists.
router.post('/verify-otp', limitVerifyOtp, async (req, res) => {
  const email = req.body?.email;
  const otp = req.body?.otp;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  try {
    flowLog('VERIFY OTP', 'Request received', { email, otp: mask(otp) });
    req.log?.info('auth.verify_otp.start', { email });
    const verified = await verifyOtpFromAuditLog({ email, otp });
    if (!verified.ok) {
      flowLog('VERIFY OTP', 'OTP invalid or expired', { email, reason: verified.reason });
      req.log?.info('auth.verify_otp.failed', { email, reason: verified.reason });
      req.setLogSummary?.('OTP verification failed', { email, reason: verified.reason });
      await writeAuditLog({
        action: 'AUTH_VERIFY_OTP_FAILED',
        entityType: 'login_otp',
        entityId: email,
        details: { ...getReqMeta(req), reason: verified.reason },
      });
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    flowLog('VERIFY OTP', 'OTP valid', { email });
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    let userRow = userResult.rows[0];
    if (userRow.is_active === false) return res.status(403).json({ error: 'User is inactive' });

    // Single-device login for students: bump token_version so older JWTs become invalid.
    if (userRow.role === 'student') {
      const bumped = await pool.query(
        `UPDATE users
         SET token_version = token_version + 1
         WHERE id = $1
         RETURNING token_version`,
        [userRow.id]
      );
      userRow = { ...userRow, token_version: Number(bumped.rows?.[0]?.token_version ?? 0) };
    }

    const today = getISTDateString();
    const hostelId =
      userRow.role === 'manager'
        ? await getActiveManagerHostel({ userId: userRow.id, date: today })
        : await getActiveHostelAssignment({ userId: userRow.id, date: today });

    const token = signAppToken({ userRow, hostelId });
    flowLog('VERIFY OTP', 'JWT issued', { email, token: mask(token) });
    req.log?.info('auth.verify_otp.success', { email, user_id: userRow.id, role: userRow.role, hostel_id: hostelId ?? null });
    req.setLogSummary?.('OTP verified; token issued', { email, user_id: userRow.id, role: userRow.role });
    await writeAuditLog({
      collegeId: userRow.college_id ?? null,
      actorUserId: userRow.id,
      action: 'AUTH_VERIFY_OTP',
      entityType: 'user',
      entityId: userRow.id,
      details: { ...getReqMeta(req), role: userRow.role, hostel_id: hostelId ?? null },
    });
    const responseBody = { success: true, message: 'OTP verified', token };
    flowLog('VERIFY OTP', 'Response', { success: responseBody.success, message: responseBody.message });
    return res.json(responseBody);
  } catch (err) {
    flowLog('VERIFY OTP', 'Error', { email, error: err?.message || String(err) });
    req.log?.error('auth.verify_otp.error', { email, error: err?.message || String(err) });
    req.setLogSummary?.('OTP verification error', { email });
    await writeAuditLog({
      action: 'AUTH_VERIFY_OTP_ERROR',
      entityType: 'login_otp',
      entityId: email,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to verify OTP', err);
  }
});

// Save student profile details for the authenticated user and return a refreshed token.
// POST /auth/save-details (auth)
router.post('/save-details', authenticateToken, limitSaveDetails, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, username, phone, roll_no, room_no, college_id } = req.body || {};
  const finalName = name || username;
  if (!finalName) return res.status(400).json({ error: 'name (or username) is required' });
  if (req.body?.email) return res.status(400).json({ error: 'email cannot be changed' });
  if (req.body?.hostel_id) return res.status(400).json({ error: 'hostel_id cannot be set here' });

  try {
    req.log?.info('auth.save_details.start', { user_id: userId });
    const updated = await pool.query(
      `UPDATE users
       SET college_id = COALESCE($1, college_id),
           name = $2,
           phone = COALESCE($3, phone),
           roll_no = COALESCE($4, roll_no),
           room_no = COALESCE($5, room_no)
       WHERE id = $6
       RETURNING *`,
      [college_id ?? null, finalName, phone ?? null, roll_no ?? null, room_no ?? null, userId]
    );
    if (updated.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userRow = updated.rows[0];
    if (userRow.is_active === false) return res.status(403).json({ error: 'User is inactive' });

    const today = getISTDateString();
    const activeHostelId = await getActiveHostelAssignment({ userId: userRow.id, date: today });

    const token = signAppToken({ userRow, hostelId: activeHostelId });
    req.log?.info('auth.save_details.success', { user_id: userRow.id, hostel_id: activeHostelId ?? null });
    req.setLogSummary?.('Profile saved; token issued', { user_id: userRow.id, hostel_id: activeHostelId ?? null });
    await writeAuditLog({
      collegeId: userRow.college_id ?? null,
      actorUserId: userRow.id,
      action: 'AUTH_SAVE_DETAILS',
      entityType: 'user',
      entityId: userRow.id,
      details: {
        ...getReqMeta(req),
        fields: {
          name: finalName ? true : false,
          phone: phone !== undefined,
          roll_no: roll_no !== undefined,
          room_no: room_no !== undefined,
          college_id: college_id !== undefined,
        },
        hostel_id: activeHostelId ?? null,
      },
    });
    return res.json({ success: true, message: 'User details saved', token });
  } catch (err) {
    console.error('[SAVE DETAILS] Error:', err);
    req.log?.error('auth.save_details.error', { email, error: err?.message || String(err) });
    req.setLogSummary?.('Profile save failed', { email });
    await writeAuditLog({
      action: 'AUTH_SAVE_DETAILS_ERROR',
      entityType: 'user',
      entityId: String(userId),
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to save user details', err);
  }
});

module.exports = router;
