const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const requireRole = require('../middleware/requireRole');
const { getISTDateString } = require('../utils/date');
const { writeAuditLog, getReqMeta } = require('../utils/audit');
const { flowLog } = require('../utils/flowLog');
const { respondServerError } = require('../utils/http');

const router = express.Router();

// All manage routes require authentication.
router.use(authenticateToken);

const VALID_ROLES = ['student', 'manager', 'admin'];

// ─── Helper ─────────────────────────────────────────────────────────────────

async function getManagerAccessibleHostelIds({ userId }) {
  const today = getISTDateString();
  const res = await pool.query(
    `SELECT hs.hostel_id, h.mess_id
     FROM hostel_staff hs
     JOIN hostels h ON h.id = hs.hostel_id
     WHERE hs.user_id = $1
       AND hs.start_date <= $2
       AND (hs.end_date IS NULL OR hs.end_date >= $2)
     ORDER BY hs.start_date DESC
     LIMIT 1`,
    [userId, today]
  );
  const row = res.rows?.[0];
  if (!row) return [];
  if (row.mess_id) {
    const scope = await pool.query(
      `SELECT id FROM hostels WHERE mess_id = $1 AND is_active = true`,
      [row.mess_id]
    );
    return scope.rows.map(r => Number(r.id));
  }
  return [Number(row.hostel_id)];
}

// ─── Users (admin only) ──────────────────────────────────────────────────────

// POST /manage/users — Create user
router.post('/users', requireRole('admin'), async (req, res) => {
  const { email, name, role, college_id, phone, roll_no, room_no } = req.body || {};
  if (!email || !name || !role || !college_id) {
    return res.status(400).json({ error: 'email, name, role, and college_id are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be student, manager, or admin' });
  }

  try {
    flowLog('MANAGE USERS', 'Create requested', { email, role });
    const result = await pool.query(
      `INSERT INTO users (email, name, role, college_id, phone, roll_no, room_no, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id, email, name, role, college_id, phone, roll_no, room_no, is_active, created_at`,
      [email, name, role, college_id, phone || null, roll_no || null, room_no || null]
    );

    await writeAuditLog({
      collegeId: college_id,
      actorUserId: req.user.id,
      action: 'MANAGE_USER_CREATE',
      entityType: 'user',
      entityId: result.rows[0].id,
      details: { ...getReqMeta(req), email, role },
    });
    flowLog('MANAGE USERS', 'Created', { id: result.rows[0].id, email });
    return res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    flowLog('MANAGE USERS', 'Create error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// GET /manage/users — List users
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    const where = [];
    const params = [];

    if (req.query.college_id) {
      params.push(Number(req.query.college_id));
      where.push(`u.college_id = $${params.length}`);
    }
    if (req.query.role) {
      params.push(String(req.query.role));
      where.push(`u.role = $${params.length}`);
    }
    if (req.query.hostel_id) {
      params.push(Number(req.query.hostel_id));
      const today = getISTDateString();
      params.push(today);
      where.push(`EXISTS (
        SELECT 1 FROM user_hostel_assignments uha
        WHERE uha.user_id = u.id
          AND uha.hostel_id = $${params.length - 1}
          AND uha.start_date <= $${params.length}
          AND (uha.end_date IS NULL OR uha.end_date >= $${params.length})
      )`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.roll_no ILIKE $${params.length})`);
    }

    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 100;
    const offset = Number(req.query.offset ?? 0) || 0;

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
      params
    );

    params.push(limit);
    params.push(offset);
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.college_id, u.roll_no, u.room_no, u.phone, u.is_active, u.created_at
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    flowLog('MANAGE USERS', 'Listed', { total: countRes.rows[0]?.total ?? 0, returned: result.rows.length });
    return res.json({ success: true, users: result.rows, total: countRes.rows[0]?.total ?? 0, limit, offset });
  } catch (err) {
    flowLog('MANAGE USERS', 'List error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// GET /manage/users/:id — Get user details
router.get('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const today = getISTDateString();

    const userRes = await pool.query(
      `SELECT u.id, u.email, u.name, u.phone, u.role, u.roll_no, u.room_no, u.college_id, u.is_active, u.created_at,
              c.code AS college_code, c.name AS college_name
       FROM users u
       LEFT JOIN colleges c ON c.id = u.college_id
       WHERE u.id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = userRes.rows[0];

    const hostelRes = await pool.query(
      `SELECT uha.id AS assignment_id, uha.hostel_id, uha.start_date, h.name AS hostel_name, h.hostel_code
       FROM user_hostel_assignments uha
       JOIN hostels h ON h.id = uha.hostel_id
       WHERE uha.user_id = $1
         AND uha.start_date <= $2
         AND (uha.end_date IS NULL OR uha.end_date >= $2)
       ORDER BY uha.start_date DESC
       LIMIT 1`,
      [userId, today]
    );

    const staffRes = await pool.query(
      `SELECT hs.id AS staff_id, hs.hostel_id, hs.role, hs.start_date, h.name AS hostel_name, h.hostel_code
       FROM hostel_staff hs
       JOIN hostels h ON h.id = hs.hostel_id
       WHERE hs.user_id = $1
         AND hs.start_date <= $2
         AND (hs.end_date IS NULL OR hs.end_date >= $2)
       ORDER BY hs.start_date DESC`,
      [userId, today]
    );

    return res.json({
      success: true,
      user: {
        id: u.id, email: u.email, name: u.name, phone: u.phone,
        role: u.role, roll_no: u.roll_no, room_no: u.room_no,
        college_id: u.college_id, is_active: u.is_active, created_at: u.created_at,
      },
      college: u.college_id
        ? { id: u.college_id, code: u.college_code, name: u.college_name }
        : null,
      current_hostel: hostelRes.rows[0] ?? null,
      staff_assignments: staffRes.rows,
    });
  } catch (err) {
    flowLog('MANAGE USERS', 'Get error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// PUT /manage/users/:id — Update user
router.put('/users/:id', requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const { name, phone, roll_no, room_no, email, role, college_id, is_active } = req.body || {};

  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be student, manager, or admin' });
  }

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (roll_no !== undefined) { fields.push(`roll_no = $${idx++}`); values.push(roll_no); }
    if (room_no !== undefined) { fields.push(`room_no = $${idx++}`); values.push(room_no); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (college_id !== undefined) { fields.push(`college_id = $${idx++}`); values.push(college_id); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(Boolean(is_active)); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, college_id, phone, roll_no, room_no, is_active`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_USER_UPDATE',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), updated_fields: fields.map(f => f.split(' = ')[0]) },
    });
    flowLog('MANAGE USERS', 'Updated', { id: userId });
    return res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    flowLog('MANAGE USERS', 'Update error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// DELETE /manage/users/:id — Soft delete
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = false WHERE id = $1 RETURNING id`,
      [userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_USER_DEACTIVATE',
      entityType: 'user',
      entityId: userId,
      details: getReqMeta(req),
    });
    flowLog('MANAGE USERS', 'Deactivated', { id: userId });
    return res.json({ success: true, message: 'User deactivated' });
  } catch (err) {
    flowLog('MANAGE USERS', 'Delete error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// DELETE /manage/users/:id/permanent — Hard delete (preserves attendance & assignment data)
router.delete('/users/:id/permanent', requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);

  try {
    // Store user info before deletion for audit
    const userRes = await pool.query(`SELECT id, email, name FROM users WHERE id = $1`, [userId]);
    if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const { email, name } = userRes.rows[0];

    // Delete user — related records are preserved with user_id set to NULL
    // via ON DELETE SET NULL foreign key constraints
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_USER_PERMANENT_DELETE',
      entityType: 'user',
      entityId: userId,
      details: { ...getReqMeta(req), deleted_email: email, deleted_name: name },
    });
    flowLog('MANAGE USERS', 'Permanently deleted', { id: userId, email });
    return res.json({ success: true, message: 'User permanently deleted' });
  } catch (err) {
    flowLog('MANAGE USERS', 'Permanent delete error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// ─── Hostels (admin only) ────────────────────────────────────────────────────

// POST /manage/hostels — Create hostel
router.post('/hostels', requireRole('admin'), async (req, res) => {
  const { college_id, hostel_code, name, mess_id, address } = req.body || {};
  if (!college_id || !hostel_code || !name || !mess_id) {
    return res.status(400).json({ error: 'college_id, hostel_code, name, and mess_id are required' });
  }

  try {
    // Validate mess belongs to same college
    const messRes = await pool.query(
      `SELECT mess_no FROM messes WHERE id = $1 AND college_id = $2`,
      [mess_id, college_id]
    );
    if (messRes.rows.length === 0) {
      return res.status(422).json({ error: 'mess_id does not belong to this college' });
    }
    const messNo = messRes.rows[0].mess_no;

    const result = await pool.query(
      `INSERT INTO hostels (college_id, hostel_code, name, address, mess_id, mess_no, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, college_id, hostel_code, name, address, mess_id, mess_no, is_active, created_at`,
      [college_id, hostel_code, name, address || null, mess_id, messNo]
    );

    await writeAuditLog({
      collegeId: college_id,
      actorUserId: req.user.id,
      action: 'MANAGE_HOSTEL_CREATE',
      entityType: 'hostel',
      entityId: result.rows[0].id,
      details: { ...getReqMeta(req), hostel_code, mess_id },
    });
    flowLog('MANAGE HOSTELS', 'Created', { id: result.rows[0].id, hostel_code });
    return res.status(201).json({ success: true, hostel: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Hostel code already exists for this college' });
    flowLog('MANAGE HOSTELS', 'Create error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// GET /manage/hostels — List hostels
router.get('/hostels', requireRole('admin'), async (req, res) => {
  try {
    const where = [];
    const params = [];

    if (req.query.college_id) {
      params.push(Number(req.query.college_id));
      where.push(`h.college_id = $${params.length}`);
    }
    if (req.query.mess_id) {
      params.push(Number(req.query.mess_id));
      where.push(`h.mess_id = $${params.length}`);
    }
    if (String(req.query.include_inactive ?? 'false').toLowerCase() !== 'true') {
      where.push(`h.is_active = true`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT h.id, h.college_id, h.hostel_code, h.name, h.address, h.mess_id, h.mess_no, h.is_active, h.created_at
       FROM hostels h
       ${whereClause}
       ORDER BY h.name ASC`,
      params
    );

    flowLog('MANAGE HOSTELS', 'Listed', { count: result.rows.length });
    return res.json({ success: true, hostels: result.rows });
  } catch (err) {
    flowLog('MANAGE HOSTELS', 'List error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// PUT /manage/hostels/:id — Update hostel
router.put('/hostels/:id', requireRole('admin'), async (req, res) => {
  const hostelId = Number(req.params.id);
  const { name, address, hostel_code, mess_id, is_active } = req.body || {};

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (address !== undefined) { fields.push(`address = $${idx++}`); values.push(address); }
    if (hostel_code !== undefined) { fields.push(`hostel_code = $${idx++}`); values.push(hostel_code); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(Boolean(is_active)); }

    if (mess_id !== undefined) {
      // Validate mess belongs to same college as hostel
      const hostelRes = await pool.query(`SELECT college_id FROM hostels WHERE id = $1`, [hostelId]);
      if (hostelRes.rows.length === 0) return res.status(404).json({ error: 'Hostel not found' });

      const messRes = await pool.query(
        `SELECT mess_no FROM messes WHERE id = $1 AND college_id = $2`,
        [mess_id, hostelRes.rows[0].college_id]
      );
      if (messRes.rows.length === 0) {
        return res.status(422).json({ error: 'mess_id does not belong to this college' });
      }
      fields.push(`mess_id = $${idx++}`); values.push(mess_id);
      fields.push(`mess_no = $${idx++}`); values.push(messRes.rows[0].mess_no);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(hostelId);
    const result = await pool.query(
      `UPDATE hostels SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, college_id, hostel_code, name, address, mess_id, mess_no, is_active`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Hostel not found' });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_HOSTEL_UPDATE',
      entityType: 'hostel',
      entityId: hostelId,
      details: { ...getReqMeta(req), updated_fields: fields.map(f => f.split(' = ')[0]) },
    });
    flowLog('MANAGE HOSTELS', 'Updated', { id: hostelId });
    return res.json({ success: true, hostel: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Hostel code already exists for this college' });
    flowLog('MANAGE HOSTELS', 'Update error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// DELETE /manage/hostels/:id — Soft delete
router.delete('/hostels/:id', requireRole('admin'), async (req, res) => {
  const hostelId = Number(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE hostels SET is_active = false WHERE id = $1 RETURNING id`,
      [hostelId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Hostel not found' });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_HOSTEL_DEACTIVATE',
      entityType: 'hostel',
      entityId: hostelId,
      details: getReqMeta(req),
    });
    flowLog('MANAGE HOSTELS', 'Deactivated', { id: hostelId });
    return res.json({ success: true, message: 'Hostel deactivated' });
  } catch (err) {
    flowLog('MANAGE HOSTELS', 'Delete error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// ─── Messes (admin only) ─────────────────────────────────────────────────────

// POST /manage/messes — Create mess
router.post('/messes', requireRole('admin'), async (req, res) => {
  const { college_id, mess_no, name } = req.body || {};
  if (!college_id || !mess_no) {
    return res.status(400).json({ error: 'college_id and mess_no are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO messes (college_id, mess_no, name)
       VALUES ($1, $2, $3)
       RETURNING id, college_id, mess_no, name, created_at`,
      [college_id, mess_no, name || `Mess ${mess_no}`]
    );

    await writeAuditLog({
      collegeId: college_id,
      actorUserId: req.user.id,
      action: 'MANAGE_MESS_CREATE',
      entityType: 'mess',
      entityId: result.rows[0].id,
      details: { ...getReqMeta(req), mess_no },
    });
    flowLog('MANAGE MESSES', 'Created', { id: result.rows[0].id, mess_no });
    return res.status(201).json({ success: true, mess: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Mess number already exists for this college' });
    flowLog('MANAGE MESSES', 'Create error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// GET /manage/messes — List messes
router.get('/messes', requireRole('admin'), async (req, res) => {
  try {
    const where = [];
    const params = [];

    if (req.query.college_id) {
      params.push(Number(req.query.college_id));
      where.push(`m.college_id = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT m.id, m.college_id, m.mess_no, m.name, m.created_at
       FROM messes m
       ${whereClause}
       ORDER BY m.mess_no ASC`,
      params
    );

    flowLog('MANAGE MESSES', 'Listed', { count: result.rows.length });
    return res.json({ success: true, messes: result.rows });
  } catch (err) {
    flowLog('MANAGE MESSES', 'List error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// PUT /manage/messes/:id — Update mess
router.put('/messes/:id', requireRole('admin'), async (req, res) => {
  const messId = Number(req.params.id);
  const { name, mess_no } = req.body || {};

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (mess_no !== undefined) { fields.push(`mess_no = $${idx++}`); values.push(mess_no); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(messId);
    const result = await pool.query(
      `UPDATE messes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, college_id, mess_no, name`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Mess not found' });

    // Keep hostels.mess_no in sync if mess_no changed
    if (mess_no !== undefined) {
      await pool.query(`UPDATE hostels SET mess_no = $1 WHERE mess_id = $2`, [mess_no, messId]);
    }

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_MESS_UPDATE',
      entityType: 'mess',
      entityId: messId,
      details: { ...getReqMeta(req), updated_fields: fields.map(f => f.split(' = ')[0]) },
    });
    flowLog('MANAGE MESSES', 'Updated', { id: messId });
    return res.json({ success: true, mess: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Mess number already exists for this college' });
    flowLog('MANAGE MESSES', 'Update error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// DELETE /manage/messes/:id — Hard delete (reject if hostels reference it)
router.delete('/messes/:id', requireRole('admin'), async (req, res) => {
  const messId = Number(req.params.id);

  try {
    const hostelCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM hostels WHERE mess_id = $1`,
      [messId]
    );
    if ((hostelCount.rows[0]?.count ?? 0) > 0) {
      return res.status(409).json({ error: 'Cannot delete mess: hostels are still assigned to it' });
    }

    const result = await pool.query(`DELETE FROM messes WHERE id = $1 RETURNING id`, [messId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Mess not found' });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_MESS_DELETE',
      entityType: 'mess',
      entityId: messId,
      details: getReqMeta(req),
    });
    flowLog('MANAGE MESSES', 'Deleted', { id: messId });
    return res.json({ success: true, message: 'Mess deleted' });
  } catch (err) {
    flowLog('MANAGE MESSES', 'Delete error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// ─── Student Assignments (admin + manager) ───────────────────────────────────

// POST /manage/assignments — Assign student to hostel
router.post('/assignments', requireRole('admin', 'manager'), async (req, res) => {
  const { user_id, hostel_id, start_date, reason } = req.body || {};
  if (!user_id || !hostel_id) {
    return res.status(400).json({ error: 'user_id and hostel_id are required' });
  }

  const today = getISTDateString();
  const effectiveStartDate = start_date || today;

  try {
    // Manager scope check
    if (req.user.role === 'manager') {
      const accessible = await getManagerAccessibleHostelIds({ userId: req.user.id });
      if (!accessible.includes(Number(hostel_id))) {
        return res.status(403).json({ error: 'Hostel not in your mess scope' });
      }
    }

    // Validate user exists and is a student
    const userRes = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [user_id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (userRes.rows[0].role !== 'student') return res.status(422).json({ error: 'Only students can be assigned to hostels' });

    // Validate hostel exists and is active
    const hostelRes = await pool.query(`SELECT id FROM hostels WHERE id = $1 AND is_active = true`, [hostel_id]);
    if (hostelRes.rows.length === 0) return res.status(404).json({ error: 'Hostel not found or inactive' });

    // End any current active assignment
    await pool.query(
      `UPDATE user_hostel_assignments
       SET end_date = ($2::date - INTERVAL '1 day')::date
       WHERE user_id = $1 AND end_date IS NULL AND hostel_id != $3`,
      [user_id, effectiveStartDate, hostel_id]
    );

    // Check if already assigned to this hostel
    const existingRes = await pool.query(
      `SELECT id FROM user_hostel_assignments
       WHERE user_id = $1 AND hostel_id = $2
         AND start_date <= $3
         AND (end_date IS NULL OR end_date >= $3)`,
      [user_id, hostel_id, effectiveStartDate]
    );
    if (existingRes.rows.length > 0) {
      return res.json({ success: true, message: 'Already assigned to this hostel', assignment_id: existingRes.rows[0].id });
    }

    const result = await pool.query(
      `INSERT INTO user_hostel_assignments (user_id, hostel_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, NULL, $4)
       RETURNING id, user_id, hostel_id, start_date, end_date, reason, created_at`,
      [user_id, hostel_id, effectiveStartDate, reason || 'admin-assign']
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_ASSIGNMENT_CREATE',
      entityType: 'user_hostel_assignment',
      entityId: result.rows[0].id,
      details: { ...getReqMeta(req), user_id, hostel_id },
    });
    flowLog('MANAGE ASSIGNMENTS', 'Created', { user_id, hostel_id });
    return res.status(201).json({ success: true, assignment: result.rows[0] });
  } catch (err) {
    flowLog('MANAGE ASSIGNMENTS', 'Create error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// GET /manage/assignments — List assignments
router.get('/assignments', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const where = [];
    const params = [];
    const today = getISTDateString();

    // Manager scope restriction
    if (req.user.role === 'manager') {
      const accessible = await getManagerAccessibleHostelIds({ userId: req.user.id });
      if (accessible.length === 0) return res.json({ success: true, assignments: [], total: 0 });
      params.push(accessible);
      where.push(`uha.hostel_id = ANY($${params.length}::int[])`);
    }

    if (req.query.hostel_id) {
      params.push(Number(req.query.hostel_id));
      where.push(`uha.hostel_id = $${params.length}`);
    }
    if (req.query.user_id) {
      params.push(Number(req.query.user_id));
      where.push(`uha.user_id = $${params.length}`);
    }
    if (String(req.query.active_only ?? 'false').toLowerCase() === 'true') {
      params.push(today);
      where.push(`uha.start_date <= $${params.length} AND (uha.end_date IS NULL OR uha.end_date >= $${params.length})`);
    }

    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 100;
    const offset = Number(req.query.offset ?? 0) || 0;

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM user_hostel_assignments uha ${whereClause}`,
      params
    );

    params.push(limit);
    params.push(offset);
    const result = await pool.query(
      `SELECT uha.id, uha.user_id, uha.hostel_id, uha.start_date, uha.end_date, uha.reason,
              u.name AS user_name, u.email AS user_email, u.roll_no AS user_roll_no,
              h.name AS hostel_name, h.hostel_code
       FROM user_hostel_assignments uha
       JOIN users u ON u.id = uha.user_id
       JOIN hostels h ON h.id = uha.hostel_id
       ${whereClause}
       ORDER BY uha.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    flowLog('MANAGE ASSIGNMENTS', 'Listed', { total: countRes.rows[0]?.total ?? 0 });
    return res.json({ success: true, assignments: result.rows, total: countRes.rows[0]?.total ?? 0, limit, offset });
  } catch (err) {
    flowLog('MANAGE ASSIGNMENTS', 'List error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// DELETE /manage/assignments/:id — End assignment
router.delete('/assignments/:id', requireRole('admin', 'manager'), async (req, res) => {
  const assignmentId = Number(req.params.id);
  const today = getISTDateString();

  try {
    const existing = await pool.query(
      `SELECT id, hostel_id, end_date FROM user_hostel_assignments WHERE id = $1`,
      [assignmentId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    if (existing.rows[0].end_date) return res.status(409).json({ error: 'Assignment already ended' });

    // Manager scope check
    if (req.user.role === 'manager') {
      const accessible = await getManagerAccessibleHostelIds({ userId: req.user.id });
      if (!accessible.includes(Number(existing.rows[0].hostel_id))) {
        return res.status(403).json({ error: 'Hostel not in your mess scope' });
      }
    }

    const result = await pool.query(
      `UPDATE user_hostel_assignments SET end_date = $1 WHERE id = $2 RETURNING id, user_id, hostel_id, start_date, end_date`,
      [today, assignmentId]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_ASSIGNMENT_END',
      entityType: 'user_hostel_assignment',
      entityId: assignmentId,
      details: getReqMeta(req),
    });
    flowLog('MANAGE ASSIGNMENTS', 'Ended', { id: assignmentId });
    return res.json({ success: true, message: 'Assignment ended', assignment: result.rows[0] });
  } catch (err) {
    flowLog('MANAGE ASSIGNMENTS', 'End error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// ─── Staff Assignments (admin only) ──────────────────────────────────────────

// POST /manage/staff — Assign manager to hostel
router.post('/staff', requireRole('admin'), async (req, res) => {
  const { user_id, hostel_id, start_date } = req.body || {};
  if (!user_id || !hostel_id) {
    return res.status(400).json({ error: 'user_id and hostel_id are required' });
  }

  const today = getISTDateString();
  const effectiveStartDate = start_date || today;

  try {
    // Validate user is a manager
    const userRes = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [user_id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (userRes.rows[0].role !== 'manager') return res.status(422).json({ error: 'Only managers can be assigned as staff' });

    // Validate hostel exists
    const hostelRes = await pool.query(`SELECT id FROM hostels WHERE id = $1 AND is_active = true`, [hostel_id]);
    if (hostelRes.rows.length === 0) return res.status(404).json({ error: 'Hostel not found or inactive' });

    const result = await pool.query(
      `INSERT INTO hostel_staff (user_id, hostel_id, role, start_date)
       VALUES ($1, $2, 'manager', $3)
       RETURNING id, user_id, hostel_id, role, start_date, end_date, created_at`,
      [user_id, hostel_id, effectiveStartDate]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_STAFF_CREATE',
      entityType: 'hostel_staff',
      entityId: result.rows[0].id,
      details: { ...getReqMeta(req), user_id, hostel_id },
    });
    flowLog('MANAGE STAFF', 'Created', { user_id, hostel_id });
    return res.status(201).json({ success: true, staff: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Staff assignment already exists for this date' });
    flowLog('MANAGE STAFF', 'Create error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// GET /manage/staff — List staff assignments
router.get('/staff', requireRole('admin'), async (req, res) => {
  try {
    const where = [];
    const params = [];
    const today = getISTDateString();

    if (req.query.hostel_id) {
      params.push(Number(req.query.hostel_id));
      where.push(`hs.hostel_id = $${params.length}`);
    }
    if (req.query.user_id) {
      params.push(Number(req.query.user_id));
      where.push(`hs.user_id = $${params.length}`);
    }
    if (String(req.query.active_only ?? 'false').toLowerCase() === 'true') {
      params.push(today);
      where.push(`hs.start_date <= $${params.length} AND (hs.end_date IS NULL OR hs.end_date >= $${params.length})`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT hs.id, hs.user_id, hs.hostel_id, hs.role, hs.start_date, hs.end_date,
              u.name AS user_name, u.email AS user_email,
              h.name AS hostel_name, h.hostel_code
       FROM hostel_staff hs
       JOIN users u ON u.id = hs.user_id
       JOIN hostels h ON h.id = hs.hostel_id
       ${whereClause}
       ORDER BY hs.created_at DESC`,
      params
    );

    flowLog('MANAGE STAFF', 'Listed', { count: result.rows.length });
    return res.json({ success: true, staff: result.rows });
  } catch (err) {
    flowLog('MANAGE STAFF', 'List error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

// DELETE /manage/staff/:id — End staff assignment
router.delete('/staff/:id', requireRole('admin'), async (req, res) => {
  const staffId = Number(req.params.id);
  const today = getISTDateString();

  try {
    const existing = await pool.query(
      `SELECT id, end_date FROM hostel_staff WHERE id = $1`,
      [staffId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Staff assignment not found' });
    if (existing.rows[0].end_date) return res.status(409).json({ error: 'Staff assignment already ended' });

    const result = await pool.query(
      `UPDATE hostel_staff SET end_date = $1 WHERE id = $2 RETURNING id, user_id, hostel_id, role, start_date, end_date`,
      [today, staffId]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user.id,
      action: 'MANAGE_STAFF_END',
      entityType: 'hostel_staff',
      entityId: staffId,
      details: getReqMeta(req),
    });
    flowLog('MANAGE STAFF', 'Ended', { id: staffId });
    return res.json({ success: true, message: 'Staff assignment ended', staff: result.rows[0] });
  } catch (err) {
    flowLog('MANAGE STAFF', 'End error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Server error', err);
  }
});

module.exports = router;
