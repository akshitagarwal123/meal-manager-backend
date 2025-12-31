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

// Return the authenticated user's profile + current hostel (IST).
router.get('/me', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    flowLog('USER ME', 'Request received', { email: req.user?.email });
    const today = getISTDateString();
    const userRes = await pool.query(
      `SELECT u.id, u.email, u.name, u.phone, u.role, u.roll_no, u.room_no, u.college_id, u.is_active,
              c.code AS college_code, c.name AS college_name
       FROM users u
       LEFT JOIN colleges c ON c.id = u.college_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const u = userRes.rows[0];
    if (u.is_active === false) return res.status(403).json({ error: 'User is inactive' });

    const hostelId =
      u.role === 'manager'
        ? await getActiveManagerHostel({ userId, date: today })
        : await getActiveHostelAssignment({ userId, date: today });

    let hostel = null;
    if (hostelId) {
      const hostelRes = await pool.query(
        `SELECT id, hostel_code, name, address, college_id
         FROM hostels
         WHERE id = $1
         LIMIT 1`,
        [hostelId]
      );
      hostel = hostelRes.rows?.[0] ?? null;
    }

    await writeAuditLog({
      collegeId: u.college_id ?? null,
      actorUserId: userId,
      action: 'USER_ME',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), hostel_id: hostelId ?? null },
    });

    flowLog('USER ME', 'Returned', { email: u.email, hostel_id: hostelId ?? '' });
    return res.json({
      success: true,
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        phone: u.phone,
        role: u.role,
        roll_no: u.roll_no,
        room_no: u.room_no,
        college_id: u.college_id,
      },
      college: u.college_id
        ? { id: u.college_id, code: u.college_code ?? null, name: u.college_name ?? null }
        : null,
      hostel_id: hostelId ?? null,
      hostel,
    });
  } catch (err) {
    console.error('[USER ME] Error:', err.message);
    flowLog('USER ME', 'Error', { email: req.user?.email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_ME_ERROR',
      entityType: 'api',
      entityId: '/user/me',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// List hostels for selection (legacy path kept: /user/pgs).
router.get('/pgs', authenticateToken, async (req, res) => {
  try {
    flowLog('HOSTELS', 'List requested', { email: req.user?.email, college_id: req.query.college_id ?? req.user?.college_id ?? '' });
    const collegeId = req.query.college_id || req.user?.college_id || null;
    const params = [];
    let where = 'WHERE is_active = true';
    if (collegeId) {
      params.push(collegeId);
      where += ` AND college_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, hostel_code, name, address, college_id
       FROM hostels
       ${where}
       ORDER BY name ASC`,
      params
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'USER_LIST_HOSTELS',
      entityType: 'college',
      entityId: collegeId ?? 'all',
      details: { ...getReqMeta(req), count: result.rows.length },
    });
    flowLog('HOSTELS', 'Returned', { count: result.rows.length });
    res.json({ success: true, hostels: result.rows });
  } catch (err) {
    console.error('[GET HOSTELS] Error:', err.message);
    flowLog('HOSTELS', 'Error', { error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'USER_LIST_HOSTELS_ERROR',
      entityType: 'api',
      entityId: '/user/pgs',
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to fetch hostels', err);
  }
});

// Student updates their own profile (uses token email/id).
router.put('/update-details', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, phone, roll_no, room_no, device_token, is_active } = req.body || {};

  try {
    flowLog('UPDATE DETAILS', 'Request received', { email: req.user?.email });
    req.log?.info('user.update_details.start', { user_id: userId });
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(name);
    }
    if (phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(phone);
    }
    if (roll_no !== undefined) {
      fields.push(`roll_no = $${idx++}`);
      values.push(roll_no);
    }
    if (room_no !== undefined) {
      fields.push(`room_no = $${idx++}`);
      values.push(room_no);
    }
    if (device_token !== undefined) {
      fields.push(`device_token = $${idx++}`);
      values.push(device_token);
    }
    if (is_active !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(Boolean(is_active));
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    req.log?.info('user.update_details.success', { user_id: userId, updated: fields.length });
    flowLog('UPDATE DETAILS', 'Updated', { email: req.user?.email, fields: fields.length });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_UPDATE_DETAILS',
      entityType: 'user',
      entityId: userId,
      details: {
        ...getReqMeta(req),
        fields: {
          name: name !== undefined,
          phone: phone !== undefined,
          roll_no: roll_no !== undefined,
          room_no: room_no !== undefined,
          device_token: device_token !== undefined,
          is_active: is_active !== undefined,
        },
      },
    });
    return res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[UPDATE DETAILS] Error:', err.message);
    req.log?.error('user.update_details.error', { user_id: userId, error: err?.message || String(err) });
    flowLog('UPDATE DETAILS', 'Error', { email: req.user?.email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_UPDATE_DETAILS_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to update user details', err);
  }
});

// Save device token (legacy endpoint name used by existing clients).
router.post('/saveDeviceToken', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  const deviceToken = req.body?.deviceToken;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!deviceToken) return res.status(400).json({ error: 'deviceToken is required' });

  try {
    flowLog('SAVE DEVICE TOKEN', 'Request received', { user_email: req.user?.email, deviceToken: mask(deviceToken) });
    const result = await pool.query('UPDATE users SET device_token = $1 WHERE id = $2 RETURNING *', [deviceToken, userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    flowLog('SAVE DEVICE TOKEN', 'Device token updated', { user_email: req.user?.email });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_SAVE_DEVICE_TOKEN',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req) },
    });
    return res.json({ success: true, message: 'Device token updated', user: result.rows[0] });
  } catch (err) {
    flowLog('SAVE DEVICE TOKEN', 'Error', { user_email: req.user?.email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_SAVE_DEVICE_TOKEN_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Enroll student into a hostel (immediate assignment).
router.post('/enroll', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const hostelId = req.body?.hostel_id;
  if (!hostelId) return res.status(400).json({ error: 'Hostel ID is required' });

  const today = getISTDateString();

  try {
    flowLog('ENROLL', 'Request received', { email: req.user?.email, hostel_id: hostelId });
    req.log?.info('user.enroll.start', { user_id: userId, hostel_id: hostelId });
    const existing = await getActiveHostelAssignment({ userId, date: today });
    if (existing && String(existing) === String(hostelId)) {
      req.log?.info('user.enroll.noop', { user_id: userId, hostel_id: existing });
      flowLog('ENROLL', 'Already enrolled', { email: req.user?.email, hostel_id: existing });
      await writeAuditLog({
        collegeId: req.user?.college_id ?? null,
        actorUserId: userId,
        action: 'USER_ENROLL_NOOP',
        entityType: 'user',
        entityId: userId,
        details: { ...getReqMeta(req), hostel_id: existing },
      });
      return res.json({ success: true, message: 'Already enrolled in this hostel', hostel_id: existing });
    }

    if (existing) {
      await pool.query(
        `UPDATE user_hostel_assignments
         SET end_date = ($2::date - INTERVAL '1 day')::date
         WHERE user_id = $1 AND hostel_id = $3 AND end_date IS NULL`,
        [userId, today, existing]
      );
    }

    await pool.query(
      `INSERT INTO user_hostel_assignments (user_id, hostel_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, NULL, $4)`,
      [userId, hostelId, today, 'app-enroll']
    );

    req.log?.info('user.enroll.success', { user_id: userId, hostel_id: hostelId, previous_hostel_id: existing ?? null });
    flowLog('ENROLL', 'Enrolled', { email: req.user?.email, hostel_id: hostelId });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_ENROLL',
      entityType: 'user_hostel_assignment',
      entityId: `${userId}:${hostelId}:${today}`,
      details: { ...getReqMeta(req), hostel_id: hostelId, previous_hostel_id: existing ?? null },
    });
    return res.json({ success: true, message: 'Hostel enrollment saved', hostel_id: hostelId });
  } catch (err) {
    console.error('[ENROLL] Error:', err.message);
    req.log?.error('user.enroll.error', { user_id: userId, hostel_id: hostelId, error: err?.message || String(err) });
    flowLog('ENROLL', 'Error', { email: req.user?.email, hostel_id: hostelId, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_ENROLL_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err), hostel_id: hostelId },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Student QR generation (QR contains student identity).
router.get('/qrcode', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  const email = req.user?.email;
  if (!userId || !email) return res.status(401).json({ error: 'Unauthorized' });

  try {
    flowLog('QRCODE', 'Request received', { email });
    const today = getISTDateString();
    const hostelId = await getActiveHostelAssignment({ userId, date: today });
    const QRCode = require('qrcode');
    const ttlSeconds = Number(process.env.QR_TOKEN_TTL_SECONDS || 30);
    const tokenSecret = process.env.QR_TOKEN_SECRET || process.env.JWT_SECRET;
    if (!tokenSecret) return respondServerError(res, req, 'Server error', new Error('QR_TOKEN_SECRET/JWT_SECRET not set'));

    // Signed, short-lived token for dynamic QR.
    const qrToken = jwt.sign(
      { typ: 'qr', user_id: userId, email, hostel_id: hostelId ?? null },
      tokenSecret,
      { expiresIn: ttlSeconds }
    );

    const payload = { qr_token: qrToken };
    const qr = await QRCode.toDataURL(JSON.stringify(payload));
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_QR_GENERATED',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), hostel_id: hostelId ?? null },
    });
    flowLog('QRCODE', 'Generated', { email, hostel_id: hostelId ?? '', ttl_seconds: String(ttlSeconds) });
    return res.json({ qr, payload, expires_in_seconds: ttlSeconds });
  } catch (err) {
    flowLog('QRCODE', 'Error', { email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_QR_GENERATED_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to generate QR', err);
  }
});

// Home/planner: weekly menu for the student's hostel (read-only).
router.get('/assigned-meals', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    flowLog('ASSIGNED MEALS', 'Request received', { email: req.user?.email });
    const today = getISTDateString();
    const hostelId = await getActiveHostelAssignment({ userId, date: today });
    if (!hostelId) return res.status(403).json({ error: 'User not enrolled in any hostel' });

    const daysRes = await pool.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS date, EXTRACT(DOW FROM d)::int AS dow
       FROM generate_series($1::date, ($1::date + INTERVAL '6 day')::date, INTERVAL '1 day') d`,
      [today]
    );

    const templateRes = await pool.query(
      `SELECT day_of_week, meal, status, note, items
       FROM hostel_weekly_menus
       WHERE hostel_id = $1`,
      [hostelId]
    );
    const templates = new Map(templateRes.rows.map(r => [`${r.day_of_week}:${r.meal}`, r]));

    const overrideRes = await pool.query(
      `SELECT to_char(date::date, 'YYYY-MM-DD') AS date, meal, status, note, items
       FROM meal_calendars
       WHERE hostel_id = $1
         AND date >= $2::date
         AND date <= ($2::date + INTERVAL '6 day')::date`,
      [hostelId, today]
    );
    const overrides = new Map(overrideRes.rows.map(r => [`${r.date}:${r.meal}`, r]));

    const meals = [];
    for (const day of daysRes.rows) {
      const date = day.date; // returned as YYYY-MM-DD by pg for date
      const dow = day.dow;
      for (const meal of MEAL_TYPES) {
        const override = overrides.get(`${date}:${meal}`);
        if (override) {
          meals.push({ date, meal, status: override.status, note: override.note, items: override.items });
          continue;
        }
        const template = templates.get(`${dow}:${meal}`);
        if (template) {
          meals.push({ date, meal, status: template.status, note: template.note, items: template.items });
          continue;
        }
        meals.push({ date, meal, status: 'open', note: null, items: [] });
      }
    }
    meals.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : MEAL_TYPES.indexOf(a.meal) - MEAL_TYPES.indexOf(b.meal)));

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_ASSIGNED_MEALS',
      entityType: 'hostel',
      entityId: hostelId,
      details: { ...getReqMeta(req), from: today, returned: meals.length, overrides: overrideRes.rows.length },
    });
    flowLog('ASSIGNED MEALS', 'Returned', { hostel_id: hostelId, days: 7, overrides: overrideRes.rows.length });

    const responseBody = { hostel_id: hostelId, from: today, to: null, meals };
    if (String(process.env.LOG_ASSIGNED_MEALS_RESPONSE ?? 'false').toLowerCase() === 'true') {
      const max = Number(process.env.LOG_RESPONSE_MAX_CHARS || 8000);
      const text = JSON.stringify(responseBody);
      console.log('[ASSIGNED MEALS] Response:', text.length > max ? text.slice(0, max) + '...(truncated)' : text);
    }
    return res.json(responseBody);
  } catch (err) {
    console.error('[ASSIGNED MEALS] Error:', err.message);
    flowLog('ASSIGNED MEALS', 'Error', { email: req.user?.email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_ASSIGNED_MEALS_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Student stats: attended/missed per meal type (aggregated counts).
router.get('/stats', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const from = req.query.from;
  const to = req.query.to;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });

  const isValidDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isValidDate(from) || !isValidDate(to)) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });

  try {
    flowLog('STATS', 'Request received', { email: req.user?.email, from, to });
    const today = getISTDateString();
    const toCapped = to > today ? today : to;
    if (from > toCapped) return res.status(400).json({ error: 'from must be <= to (after capping to today)' });

    // Ensure the user is assigned to a hostel for at least one date in range.
    const assignedCountRes = await pool.query(
      `WITH days AS (
         SELECT d::date AS date
         FROM generate_series($1::date, $2::date, INTERVAL '1 day') d
       )
       SELECT COUNT(*)::int AS assigned_days
       FROM days
       JOIN LATERAL (
         SELECT hostel_id
         FROM user_hostel_assignments
         WHERE user_id = $3
           AND start_date <= days.date
           AND (end_date IS NULL OR end_date >= days.date)
         ORDER BY start_date DESC
         LIMIT 1
       ) a ON true`,
      [from, toCapped, userId]
    );
    const assignedDays = assignedCountRes.rows?.[0]?.assigned_days ?? 0;
    if (!assignedDays) return res.status(403).json({ error: 'User not enrolled in any hostel' });

    const statsRes = await pool.query(
      `WITH days AS (
         SELECT d::date AS date, EXTRACT(DOW FROM d)::int AS dow
         FROM generate_series($1::date, $2::date, INTERVAL '1 day') d
       ),
       assigned AS (
         SELECT days.date, days.dow,
                (
                  SELECT hostel_id
                  FROM user_hostel_assignments
                  WHERE user_id = $3
                    AND start_date <= days.date
                    AND (end_date IS NULL OR end_date >= days.date)
                  ORDER BY start_date DESC
                  LIMIT 1
                ) AS hostel_id
         FROM days
       ),
       assigned_days AS (
         SELECT date, dow, hostel_id
         FROM assigned
         WHERE hostel_id IS NOT NULL
       ),
       meal_types AS (
         SELECT * FROM (VALUES ('breakfast'::text), ('lunch'::text), ('snacks'::text), ('dinner'::text)) AS t(meal)
       ),
       merged AS (
         SELECT ad.date,
                ad.hostel_id,
                mt.meal,
                COALESCE(mc.status, twm.status, 'open') AS status
         FROM assigned_days ad
         CROSS JOIN meal_types mt
         LEFT JOIN meal_calendars mc
           ON mc.hostel_id = ad.hostel_id AND mc.date = ad.date AND mc.meal = mt.meal
         LEFT JOIN hostel_weekly_menus twm
           ON twm.hostel_id = ad.hostel_id AND twm.day_of_week = ad.dow AND twm.meal = mt.meal
       ),
       eligible AS (
         SELECT meal, SUM((status = 'open')::int)::int AS eligible
         FROM merged
         GROUP BY meal
       ),
       attended AS (
         SELECT a.meal, COUNT(*)::int AS attended
         FROM attendance_scans a
         JOIN assigned_days ad
           ON ad.date = a.date AND ad.hostel_id = a.hostel_id
         WHERE a.user_id = $3
           AND a.date >= $1::date AND a.date <= $2::date
         GROUP BY a.meal
       )
       SELECT mt.meal,
              COALESCE(attended.attended, 0)::int AS attended,
              COALESCE(eligible.eligible, 0)::int AS eligible
       FROM meal_types mt
       LEFT JOIN attended USING (meal)
       LEFT JOIN eligible USING (meal)`,
      [from, toCapped, userId]
    );

    const attended = Object.fromEntries(MEAL_TYPES.map(m => [m, 0]));
    const eligible = Object.fromEntries(MEAL_TYPES.map(m => [m, 0]));
    for (const row of statsRes.rows) {
      if (attended[row.meal] !== undefined) attended[row.meal] = row.attended;
      if (eligible[row.meal] !== undefined) eligible[row.meal] = row.eligible;
    }

    const missed = Object.fromEntries(MEAL_TYPES.map(m => [m, Math.max(0, (eligible[m] || 0) - (attended[m] || 0))]));

    // Keep existing response shape (hostel_id is the user's active hostel on the capped "to" date).
    const hostelId = await getActiveHostelAssignment({ userId, date: toCapped });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_STATS',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), from, to: toCapped, hostel_id: hostelId, assigned_days: assignedDays },
    });
    flowLog('STATS', 'Returned', { email: req.user?.email, hostel_id: hostelId, assigned_days: assignedDays });
    return res.json({ from, to: toCapped, hostel_id: hostelId, attended, missed });
  } catch (err) {
    console.error('[STATS] Error:', err.message);
    flowLog('STATS', 'Error', { email: req.user?.email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_STATS_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err), from, to },
    });
    return respondServerError(res, req, 'Server error', err);
  }
});

// Check whether the student is assigned to a hostel.
router.get('/check-status', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    flowLog('CHECK STATUS', 'Request received', { email: req.user?.email });
    const today = getISTDateString();
    const hostelId = await getActiveHostelAssignment({ userId, date: today });
    if (!hostelId) return res.json({ status: 0 });

    const hostelRes = await pool.query(
      'SELECT id, hostel_code, name, address, college_id FROM hostels WHERE id = $1',
      [hostelId]
    );
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_CHECK_STATUS',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), hostel_id: hostelId },
    });
    flowLog('CHECK STATUS', 'User assigned to hostel', { email: req.user?.email, hostel_id: hostelId });
    return res.json({ status: 2, hostel: hostelRes.rows?.[0] ?? { id: hostelId } });
  } catch (err) {
    flowLog('CHECK STATUS', 'Error', { email: req.user?.email, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'USER_CHECK_STATUS_ERROR',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
