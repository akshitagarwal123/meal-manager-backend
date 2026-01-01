const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const { getISTDateString } = require('../utils/date');
const { writeAuditLog, getReqMeta } = require('../utils/audit');
const { flowLog, mask } = require('../utils/flowLog');
const { respondServerError } = require('../utils/http');

const router = express.Router();

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'];
const DEFAULT_MEAL_WINDOWS = [
  { meal: 'breakfast', start_time: '06:00', end_time: '09:00', grace_minutes: 0 },
  { meal: 'lunch', start_time: '13:00', end_time: '15:00', grace_minutes: 0 },
  { meal: 'snacks', start_time: '16:30', end_time: '18:00', grace_minutes: 0 },
  { meal: 'dinner', start_time: '19:30', end_time: '21:30', grace_minutes: 0 },
];

function normalizeMeal(value) {
  const normalized = String(value || '').toLowerCase();
  return MEAL_TYPES.includes(normalized) ? normalized : null;
}

function parseTimeToMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getNowISTMinutes() {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const hh = Number(m.hour);
  const mm = Number(m.minute);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

async function getHostelMealWindow({ hostelId, meal }) {
  const result = await pool.query(
    `SELECT meal,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI') AS end_time,
            grace_minutes
     FROM hostel_meal_windows
     WHERE hostel_id = $1 AND meal = $2
     LIMIT 1`,
    [hostelId, meal]
  );
  if (result.rows.length) {
    const row = result.rows[0];
    return {
      meal: row.meal,
      start_time: row.start_time,
      end_time: row.end_time,
      grace_minutes: Number(row.grace_minutes || 0) || 0,
      source: 'db',
    };
  }
  const fallback = DEFAULT_MEAL_WINDOWS.find(w => w.meal === meal);
  if (!fallback) return null;
  return { ...fallback, source: 'default' };
}

async function getEffectiveMealStatus({ hostelId, date, meal }) {
  const override = await pool.query(
    `SELECT status
     FROM meal_calendars
     WHERE hostel_id = $1 AND date = $2::date AND meal = $3
     LIMIT 1`,
    [hostelId, date, meal]
  );
  if (override.rows.length) return String(override.rows[0].status || 'open');

  const template = await pool.query(
    `SELECT status
     FROM hostel_weekly_menus
     WHERE hostel_id = $1
       AND day_of_week = EXTRACT(DOW FROM $2::date)::int
       AND meal = $3
     LIMIT 1`,
    [hostelId, date, meal]
  );
  if (template.rows.length) return String(template.rows[0].status || 'open');
  return 'open';
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

function signManagerToken({ userRow, hostelId }) {
  return jwt.sign(
    {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: 'manager',
      college_id: userRow.college_id ?? null,
      hostel_id: hostelId ?? null,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Manager login (OTP-based). Body: { email, otp }
router.post('/login', async (req, res) => {
  const email = req.body?.email;
  const otp = req.body?.otp;
  if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });

  try {
    flowLog('MANAGER LOGIN', 'Request received', { email, otp: mask(otp) });
    const otpRes = await pool.query(
      `SELECT details
       FROM audit_logs
       WHERE entity_type = 'login_otp' AND entity_id = $1 AND action = 'OTP_GENERATED'
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );
    if (otpRes.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired OTP' });

    const details = otpRes.rows[0].details || {};
    const storedOtp = String(details.otp || '');
    const expiresAt = details.expires_at ? new Date(details.expires_at) : null;
    if (!storedOtp || storedOtp !== String(otp)) return res.status(401).json({ error: 'Invalid or expired OTP' });
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const userRes = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [email, 'manager']);
    if (userRes.rows.length === 0) return res.status(403).json({ error: 'Not a manager account' });
    const userRow = userRes.rows[0];

    const today = getISTDateString();
    const hostelId = await getActiveManagerHostel({ userId: userRow.id, date: today });
    if (!hostelId) return res.status(403).json({ error: 'Manager not assigned to any hostel' });

    const token = signManagerToken({ userRow, hostelId });
    flowLog('MANAGER LOGIN', 'JWT issued', { email, hostel_id: hostelId, token: mask(token) });
    await writeAuditLog({
      collegeId: userRow.college_id ?? null,
      actorUserId: userRow.id,
      action: 'MANAGER_LOGIN',
      entityType: 'user',
      entityId: userRow.id,
      details: { ...getReqMeta(req), hostel_id: hostelId },
    });
    return res.json({ token, hostel_id: hostelId });
  } catch (err) {
    console.error('[MANAGER LOGIN] Error:', err);
    flowLog('MANAGER LOGIN', 'Error', { email, error: err?.message || String(err) });
    await writeAuditLog({
      action: 'MANAGER_LOGIN_ERROR',
      entityType: 'login_otp',
      entityId: email,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Mark attendance for selected meal_type for today (IST).
router.post('/mark-attendance', authenticateToken, async (req, res) => {
  try {
    const managerId = req.user?.id;
    if (!managerId) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user?.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });

    const today = getISTDateString();
    const managerHostelId = await getActiveManagerHostel({ userId: managerId, date: today });
    if (!managerHostelId) return res.status(400).json({ error: 'Manager hostel ID not found' });

    const qrToken = req.body?.qr_token ?? req.body?.qrToken ?? null;
    const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
    if (!qrToken || typeof qrToken !== 'string') {
      if (req.body?.email) {
        return res.status(400).json({ error: 'qr_token is required (email-based attendance is removed)' });
      }
      return res.status(400).json({ error: 'qr_token is required' });
    }
    if (!meal) return res.status(400).json({ error: 'meal_type must be breakfast, lunch, snacks, or dinner' });

    flowLog('ATTENDANCE', 'Mark request received', { manager_email: req.user?.email, meal_type: meal, qr_token: qrToken });
    req.log?.info('admin.mark_attendance.start', { manager_id: managerId, hostel_id: managerHostelId, date: today, meal });

    // Determine student identity from the scanned QR token.
    let studentIdFromToken = null;
    let hostelFromToken = null;

    const tokenSecret = process.env.QR_TOKEN_SECRET || process.env.JWT_SECRET;
    const leewaySeconds = Number(process.env.QR_TOKEN_LEEWAY_SECONDS || 10);
    if (!tokenSecret) return respondServerError(res, req, 'Server error', new Error('QR_TOKEN_SECRET/JWT_SECRET not set'));

    try {
      const decoded = jwt.verify(qrToken, tokenSecret, { clockTolerance: leewaySeconds });
      if (decoded?.typ !== 'qr') return res.status(400).json({ error: 'Invalid qr_token' });
      studentIdFromToken = decoded.user_id ?? decoded.id ?? null;
      hostelFromToken = decoded.hostel_id ?? null;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired qr_token' });
    }

    if (studentIdFromToken === null || studentIdFromToken === undefined) {
      return res.status(400).json({ error: 'Invalid qr_token' });
    }

    flowLog('ATTENDANCE', 'QR token verified', { student_id: studentIdFromToken, hostel_id: hostelFromToken ?? '' });

    // Safety check: token hostel should match manager hostel (prevents cross-hostel scans).
    if (hostelFromToken && String(hostelFromToken) !== String(managerHostelId)) {
      return res.status(403).json({ error: 'Student not enrolled in this hostel' });
    }

    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [Number(studentIdFromToken)]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const student = userRes.rows[0];

    // Ensure student is currently assigned to same hostel.
    const assignmentRes = await pool.query(
      `SELECT 1
       FROM user_hostel_assignments
       WHERE user_id = $1
         AND hostel_id = $2
         AND start_date <= $3
         AND (end_date IS NULL OR end_date >= $3)
       LIMIT 1`,
      [student.id, managerHostelId, today]
    );
    if (assignmentRes.rows.length === 0) return res.status(403).json({ error: 'Student not enrolled in this hostel' });

    // Enforce meal availability: override > weekly template > default open.
    const effectiveStatus = await getEffectiveMealStatus({ hostelId: managerHostelId, date: today, meal });
    if (String(effectiveStatus).toLowerCase() === 'holiday') {
      return res.status(409).json({ message: 'Meal is marked as holiday' });
    }

    // Enforce meal window (IST) with grace_minutes.
    const nowMin = getNowISTMinutes();
    const window = await getHostelMealWindow({ hostelId: managerHostelId, meal });
    if (nowMin !== null && window) {
      const startMin = parseTimeToMinutes(window.start_time);
      const endMin = parseTimeToMinutes(window.end_time);
      const grace = Number(window.grace_minutes || 0) || 0;
      if (startMin !== null && endMin !== null) {
        if (nowMin < startMin || nowMin > endMin + grace) {
          return res.status(409).json({ message: 'Meal window closed' });
        }
      }
    }

    // Insert scan with dedupe constraint.
    try {
      await pool.query(
        `INSERT INTO attendance_scans (user_id, hostel_id, date, meal, scanned_by, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [student.id, managerHostelId, today, meal, managerId, req.body?.source ?? 'qr']
      );
    } catch (e) {
      if (e && e.code === '23505') return res.status(409).json({ message: 'Attendance already marked' });
      throw e;
    }

    req.log?.info('admin.mark_attendance.success', { manager_id: managerId, student_id: student.id, hostel_id: managerHostelId, date: today, meal });
    flowLog('ATTENDANCE', 'Marked', { student_email: student.email, meal_type: meal, date: today });
    req.setLogSummary?.(`attendance marked for ${student.email} (${meal})`, { student_id: student.id, meal });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: managerId,
      action: 'ATTENDANCE_MARKED',
      entityType: 'attendance_scan',
      entityId: `${managerHostelId}:${today}:${meal}:${student.id}`,
      details: { ...getReqMeta(req), student_id: student.id, student_email: student.email, source: req.body?.source ?? 'qr' },
    });
    return res.json({ message: 'Attendance marked' });
  } catch (err) {
    console.error('[MARK ATTENDANCE] Error:', err);
    req.log?.error('admin.mark_attendance.error', { error: err?.message || String(err) });
    flowLog('ATTENDANCE', 'Error', { error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'ATTENDANCE_MARKED_ERROR',
      entityType: 'api',
      entityId: '/admin/mark-attendance',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Today totals + breakdown per meal
router.get('/qr-scans/today', authenticateToken, async (req, res) => {
  try {
    const managerId = req.user?.id;
    if (!managerId) return res.status(401).json({ error: 'Unauthorized' });

    const today = getISTDateString();
    const hostelId = await getActiveManagerHostel({ userId: managerId, date: today });
    if (!hostelId) return res.status(400).json({ error: 'Manager hostel ID not found' });

    flowLog('QR SCANS', 'Today summary requested', { hostel_id: hostelId, date: today });
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM attendance_scans WHERE hostel_id = $1 AND date = $2`,
      [hostelId, today]
    );
    const breakdownRes = await pool.query(
      `SELECT meal, COUNT(*)::int AS count
       FROM attendance_scans
       WHERE hostel_id = $1 AND date = $2
       GROUP BY meal
       ORDER BY meal ASC`,
      [hostelId, today]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: managerId,
      action: 'QR_SCANS_TODAY',
      entityType: 'hostel',
      entityId: hostelId,
      details: { ...getReqMeta(req), date: today, total: totalRes.rows[0]?.total ?? 0 },
    });
    flowLog('QR SCANS', 'Today summary returned', { hostel_id: hostelId, total: totalRes.rows[0]?.total ?? 0 });
    return res.json({ date: today, hostel_id: hostelId, total: totalRes.rows[0]?.total ?? 0, breakdown: breakdownRes.rows });
  } catch (err) {
    flowLog('QR SCANS', 'Today summary error', { error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'QR_SCANS_TODAY_ERROR',
      entityType: 'api',
      entityId: '/admin/qr-scans/today',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Summary totals + breakdown per date
router.get('/qr-scans/summary', authenticateToken, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });

  try {
    const managerId = req.user?.id;
    if (!managerId) return res.status(401).json({ error: 'Unauthorized' });

    const today = getISTDateString();
    const hostelId = await getActiveManagerHostel({ userId: managerId, date: today });
    if (!hostelId) return res.status(400).json({ error: 'Manager hostel ID not found' });

    flowLog('QR SCANS', 'Range summary requested', { hostel_id: hostelId, from, to });
    const grouped = await pool.query(
      `SELECT date::text AS date, meal, COUNT(*)::int AS count
       FROM attendance_scans
       WHERE hostel_id = $1 AND date >= $2 AND date <= $3
       GROUP BY date, meal
       ORDER BY date ASC`,
      [hostelId, from, to]
    );
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM attendance_scans
       WHERE hostel_id = $1 AND date >= $2 AND date <= $3`,
      [hostelId, from, to]
    );

    const byDateMap = {};
    for (const row of grouped.rows) {
      const date = row.date;
      if (!byDateMap[date]) byDateMap[date] = { date, total: 0, breakdown: {} };
      byDateMap[date].breakdown[row.meal] = row.count;
      byDateMap[date].total += row.count;
    }

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: managerId,
      action: 'QR_SCANS_SUMMARY',
      entityType: 'hostel',
      entityId: hostelId,
      details: { ...getReqMeta(req), from, to, total: totalRes.rows[0]?.total ?? 0 },
    });
    flowLog('QR SCANS', 'Range summary returned', { hostel_id: hostelId, total: totalRes.rows[0]?.total ?? 0 });
    return res.json({ from, to, hostel_id: hostelId, total: totalRes.rows[0]?.total ?? 0, byDate: Object.values(byDateMap) });
  } catch (err) {
    flowLog('QR SCANS', 'Range summary error', { error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'QR_SCANS_SUMMARY_ERROR',
      entityType: 'api',
      entityId: '/admin/qr-scans/summary',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Details list: attendees for a meal + date
router.get('/qr-scans/details', authenticateToken, async (req, res) => {
  try {
    const managerId = req.user?.id;
    if (!managerId) return res.status(401).json({ error: 'Unauthorized' });

    const date = req.query.date || getISTDateString();
    const meal = normalizeMeal(req.query.meal_type ?? req.query.meal);
    if (!meal) return res.status(400).json({ error: 'meal_type is required' });

    const today = getISTDateString();
    const hostelId = await getActiveManagerHostel({ userId: managerId, date: today });
    if (!hostelId) return res.status(400).json({ error: 'Manager hostel ID not found' });

    flowLog('QR SCANS DETAILS', 'Request received', {
      manager_email: req.user?.email,
      hostel_id: hostelId,
      date,
      meal_type: meal,
    });
    const result = await pool.query(
      `SELECT u.email, u.name, u.phone, a.scanned_at
       FROM attendance_scans a
       JOIN users u ON u.id = a.user_id
       WHERE a.hostel_id = $1 AND a.date = $2 AND a.meal = $3
       ORDER BY COALESCE(u.name, u.email) ASC`,
      [hostelId, date, meal]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: managerId,
      action: 'QR_SCANS_DETAILS',
      entityType: 'attendance_scan',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req), count: result.rows.length },
    });
    flowLog('QR SCANS DETAILS', 'Response sent', { hostel_id: hostelId, date, meal_type: meal, count: result.rows.length });
    return res.json({ date, meal, hostel_id: hostelId, attendees: result.rows });
  } catch (err) {
    flowLog('QR SCANS DETAILS', 'Error', { error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'QR_SCANS_DETAILS_ERROR',
      entityType: 'api',
      entityId: '/admin/qr-scans/details',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Fetch recent audit logs (manager only).
// GET /admin/audit-logs?limit=100&action=...&entity_type=...&entity_id=...&actor_user_id=...
router.get('/audit-logs', authenticateToken, async (req, res) => {
  const requester = req.user;
  if (!requester?.id) return res.status(401).json({ error: 'Unauthorized' });
  if (requester.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });

  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 100;
  const includeGlobal = String(req.query.include_global ?? 'true').toLowerCase() === 'true';

  const where = [];
  const params = [];

  // Default: scope to same college if present.
  if (requester.college_id) {
    params.push(requester.college_id);
    where.push(includeGlobal ? `(college_id = $${params.length} OR college_id IS NULL)` : `college_id = $${params.length}`);
  }

  if (req.query.action) {
    params.push(String(req.query.action));
    where.push(`action = $${params.length}`);
  }
  if (req.query.entity_type) {
    params.push(String(req.query.entity_type));
    where.push(`entity_type = $${params.length}`);
  }
  if (req.query.entity_id) {
    params.push(String(req.query.entity_id));
    where.push(`entity_id = $${params.length}`);
  }
  if (req.query.actor_user_id) {
    params.push(Number(req.query.actor_user_id));
    where.push(`actor_user_id = $${params.length}`);
  }

  params.push(limit);

  try {
    flowLog('AUDIT LOGS', 'Fetch requested', { limit, action: req.query.action ?? '', entity_type: req.query.entity_type ?? '' });
    const result = await pool.query(
      `SELECT id, college_id, actor_user_id, action, entity_type, entity_id, details, created_at
       FROM audit_logs
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    await writeAuditLog({
      collegeId: requester.college_id ?? null,
      actorUserId: requester.id,
      action: 'AUDIT_LOGS_VIEW',
      entityType: 'audit_logs',
      entityId: 'list',
      details: { ...getReqMeta(req), returned: result.rows.length, filters: { action: req.query.action, entity_type: req.query.entity_type } },
    });

    flowLog('AUDIT LOGS', 'Fetched', { returned: result.rows.length });
    return res.json({ success: true, logs: result.rows });
  } catch (err) {
    flowLog('AUDIT LOGS', 'Error', { error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: requester.college_id ?? null,
      actorUserId: requester.id,
      action: 'AUDIT_LOGS_VIEW_ERROR',
      entityType: 'audit_logs',
      entityId: 'list',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

module.exports = router;
