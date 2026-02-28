const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const { getISTDateString } = require('../utils/date');
const { writeAuditLog, getReqMeta } = require('../utils/audit');
const { flowLog, mask } = require('../utils/flowLog');
const { respondServerError } = require('../utils/http');
const {
  DEFAULT_MEAL_WINDOWS,
  getMessIdForHostel,
  getManagerMessId,
  getStudentMessId,
  getMessMealWindow,
} = require('../utils/messScope');

const router = express.Router();

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'];

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

async function isMealWindowClosedForUpdates({ messId, meal, istNowMin }) {
  const window = await getMessMealWindow({ messId, meal });
  if (!window) return false;
  const endMin = parseTimeToMinutes(window.end_time);
  if (endMin === null) return false;
  const grace = Number(window.grace_minutes || 0) || 0;
  return istNowMin !== null && istNowMin > endMin + grace;
}

function parseDayOfWeek(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0 || i > 6) return null;
  return i;
}

// Resolve mess_id from request params. Accepts mess_id directly or hostel_id (backward compat).
async function resolveMessId({ messIdRaw, hostelIdRaw }) {
  if (messIdRaw) {
    const id = Number(messIdRaw);
    return Number.isFinite(id) ? id : null;
  }
  if (hostelIdRaw) {
    const hostelId = Number(hostelIdRaw);
    if (!Number.isFinite(hostelId)) return null;
    return await getMessIdForHostel(hostelId);
  }
  return null;
}

// Validate manager has access to mess_id
async function requireManagerForMess({ req, messId }) {
  const userId = req.user?.id;
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (req.user?.role !== 'manager') return { ok: false, status: 403, error: 'Forbidden' };

  const today = getISTDateString();
  const managerMessId = await getManagerMessId({ userId, date: today });
  if (!managerMessId || Number(managerMessId) !== Number(messId)) {
    return { ok: false, status: 403, error: 'Manager not assigned to this mess' };
  }
  return { ok: true, userId, messId: managerMessId };
}

// Meal windows for a mess.
// GET /meals/windows?mess_id=... or ?hostel_id=... (backward compat)
router.get('/windows', authenticateToken, async (req, res) => {
  const requester = req.user;
  if (!requester?.id) return res.status(401).json({ error: 'Unauthorized' });

  const today = getISTDateString();

  try {
    let messId = await resolveMessId({ messIdRaw: req.query.mess_id, hostelIdRaw: req.query.hostel_id });

    // If no mess_id provided, resolve from user's assignment
    if (!messId) {
      if (requester.role === 'manager') {
        messId = await getManagerMessId({ userId: requester.id, date: today });
      } else {
        messId = await getStudentMessId({ userId: requester.id, date: today });
      }
    }
    if (!messId) return res.status(403).json({ error: 'User not enrolled in any hostel/mess' });

    const result = await pool.query(
      `SELECT meal, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time, grace_minutes
       FROM mess_meal_windows
       WHERE mess_id = $1
       ORDER BY meal ASC`,
      [messId]
    );

    const windows = result.rows.length ? result.rows : DEFAULT_MEAL_WINDOWS;

    await writeAuditLog({
      collegeId: requester.college_id ?? null,
      actorUserId: requester.id,
      action: 'MEAL_WINDOWS_GET',
      entityType: 'mess',
      entityId: String(messId),
      details: { ...getReqMeta(req), count: windows.length, used_default: result.rows.length === 0 },
    });

    flowLog('MEAL WINDOWS', 'Returned', { mess_id: messId, count: windows.length, used_default: result.rows.length === 0 });
    return res.json({ mess_id: Number(messId), windows });
  } catch (err) {
    flowLog('MEAL WINDOWS', 'Error', { error: err?.message || String(err) });
    return respondServerError(res, req, 'Failed to fetch meal windows', err);
  }
});

async function upsertDateOverride(req, res) {
  const date = req.body?.date;
  const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
  const status = String(req.body?.status || 'open').toLowerCase();
  const note = req.body?.note ? String(req.body.note) : null;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  const messId = await resolveMessId({ messIdRaw: req.body?.mess_id, hostelIdRaw: req.body?.hostel_id });
  if (!messId || !date || !meal) return res.status(400).json({ error: 'mess_id (or hostel_id), date, and meal_type are required' });
  if (!['open', 'holiday'].includes(status)) return res.status(400).json({ error: 'status must be open or holiday' });

  try {
    flowLog('MEALS OVERRIDE', 'Request received', { mess_id: messId, date, meal_type: meal });
    const gate = await requireManagerForMess({ req, messId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const today = getISTDateString();
    if (String(date) === String(today)) {
      const nowMin = getNowISTMinutes();
      const closed = await isMealWindowClosedForUpdates({ messId, meal, istNowMin: nowMin });
      if (closed) return res.status(403).json({ error: 'Meal window closed; menu locked' });
    }

    const result = await pool.query(
      `INSERT INTO meal_calendars (mess_id, date, meal, status, note, items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (mess_id, date, meal)
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, items = EXCLUDED.items, updated_at = now()
       RETURNING mess_id, to_char(date::date, 'YYYY-MM-DD') AS date, meal, status, note, items, updated_at`,
      [messId, date, meal, status, note, JSON.stringify(items)]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: gate.userId,
      action: 'MEALS_DATE_OVERRIDE_UPSERT',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}:${meal}`,
      details: { ...getReqMeta(req), status, items_count: items.length, note: note ? true : false },
    });

    flowLog('MEALS OVERRIDE', 'Saved', { mess_id: messId, date, meal_type: meal, status, items_count: items.length });
    return res.json({ success: true, override: result.rows[0] });
  } catch (err) {
    console.error('[UPSERT DATE OVERRIDE] Error:', err.message);
    flowLog('MEALS OVERRIDE', 'Error', { mess_id: messId, date, meal_type: meal, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_DATE_OVERRIDE_UPSERT_ERROR',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}:${meal}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to save override', err);
  }
}

// POST /meals/template
router.post('/template', authenticateToken, async (req, res) => {
  const dayOfWeek = parseDayOfWeek(req.body?.day_of_week);
  const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
  const status = String(req.body?.status || 'open').toLowerCase();
  const note = req.body?.note ? String(req.body.note) : null;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  const messId = await resolveMessId({ messIdRaw: req.body?.mess_id, hostelIdRaw: req.body?.hostel_id });
  if (!messId || dayOfWeek === null || !meal) {
    return res.status(400).json({ error: 'mess_id (or hostel_id), day_of_week (0-6), and meal_type are required' });
  }
  if (!['open', 'holiday'].includes(status)) return res.status(400).json({ error: 'status must be open or holiday' });

  try {
    flowLog('MEALS TEMPLATE', 'Upsert request received', { mess_id: messId, day_of_week: dayOfWeek, meal_type: meal });
    const gate = await requireManagerForMess({ req, messId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const today = getISTDateString();
    const todayDowRes = await pool.query('SELECT EXTRACT(DOW FROM $1::date)::int AS dow', [today]);
    const todayDow = todayDowRes.rows?.[0]?.dow;
    if (Number(todayDow) === Number(dayOfWeek)) {
      const nowMin = getNowISTMinutes();
      const closed = await isMealWindowClosedForUpdates({ messId, meal, istNowMin: nowMin });
      if (closed) return res.status(403).json({ error: 'Meal window closed; menu locked' });
    }

    const result = await pool.query(
      `INSERT INTO mess_weekly_menus (mess_id, day_of_week, meal, status, note, items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (mess_id, day_of_week, meal)
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, items = EXCLUDED.items, updated_at = now()
       RETURNING mess_id, day_of_week, meal, status, note, items, updated_at`,
      [messId, dayOfWeek, meal, status, note, JSON.stringify(items)]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: gate.userId,
      action: 'MEALS_TEMPLATE_UPSERT',
      entityType: 'mess_weekly_menu',
      entityId: `${messId}:${dayOfWeek}:${meal}`,
      details: { ...getReqMeta(req), status, items_count: items.length, note: note ? true : false },
    });

    flowLog('MEALS TEMPLATE', 'Saved', { mess_id: messId, day_of_week: dayOfWeek, meal_type: meal, status, items_count: items.length });
    return res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error('[UPSERT TEMPLATE] Error:', err.message);
    flowLog('MEALS TEMPLATE', 'Error', { mess_id: messId, day_of_week: dayOfWeek, meal_type: meal, error: err?.message || String(err) });
    return respondServerError(res, req, 'Failed to save weekly template', err);
  }
});

// GET /meals/template?mess_id=1&day_of_week=0  (or hostel_id for backward compat)
router.get('/template', authenticateToken, async (req, res) => {
  const dayOfWeek = req.query.day_of_week !== undefined ? parseDayOfWeek(req.query.day_of_week) : null;
  if (req.query.day_of_week !== undefined && dayOfWeek === null) return res.status(400).json({ error: 'day_of_week must be 0-6' });

  const messId = await resolveMessId({ messIdRaw: req.query.mess_id, hostelIdRaw: req.query.hostel_id });
  if (!messId) return res.status(400).json({ error: 'mess_id or hostel_id is required' });

  try {
    flowLog('MEALS TEMPLATE', 'Fetch request received', { mess_id: messId, day_of_week: dayOfWeek ?? 'all' });
    const gate = await requireManagerForMess({ req, messId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const params = [messId];
    let where = 'WHERE mess_id = $1';
    if (dayOfWeek !== null) {
      params.push(dayOfWeek);
      where += ` AND day_of_week = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT mess_id, day_of_week, meal, status, note, items, updated_at
       FROM mess_weekly_menus
       ${where}
       ORDER BY day_of_week ASC, meal ASC`,
      params
    );

    flowLog('MEALS TEMPLATE', 'Fetched', { mess_id: messId, count: result.rows.length });
    return res.json({ success: true, mess_id: messId, templates: result.rows });
  } catch (err) {
    console.error('[GET TEMPLATE] Error:', err.message);
    flowLog('MEALS TEMPLATE', 'Error', { mess_id: messId, error: err?.message || String(err) });
    return respondServerError(res, req, 'Failed to fetch weekly template', err);
  }
});

// GET /meals/menu?mess_id=1&date=YYYY-MM-DD  (or hostel_id for backward compat)
router.get('/menu', authenticateToken, async (req, res) => {
  const date = req.query.date;
  const messId = await resolveMessId({ messIdRaw: req.query.mess_id, hostelIdRaw: req.query.hostel_id });
  if (!messId || !date) return res.status(400).json({ error: 'mess_id (or hostel_id) and date are required as query params' });

  try {
    flowLog('MEALS MENU', 'Fetch request received', { mess_id: messId, date });
    const overrideRes = await pool.query(
      `SELECT mess_id, to_char(date::date, 'YYYY-MM-DD') AS date, meal, status, note, items
       FROM meal_calendars
       WHERE mess_id = $1 AND date = $2
       ORDER BY meal ASC`,
      [messId, date]
    );
    const overrides = new Map(overrideRes.rows.map(r => [r.meal, r]));

    const templateRes = await pool.query(
      `SELECT meal, status, note, items
       FROM mess_weekly_menus
       WHERE mess_id = $1
         AND day_of_week = EXTRACT(DOW FROM $2::date)::int
       ORDER BY meal ASC`,
      [messId, date]
    );
    const templates = new Map(templateRes.rows.map(r => [r.meal, r]));

    const merged = MEAL_TYPES.map(meal => {
      const override = overrides.get(meal);
      if (override) return override;
      const template = templates.get(meal);
      if (template) {
        return {
          mess_id: Number(messId),
          date,
          meal,
          status: template.status,
          note: template.note,
          items: template.items,
        };
      }
      return { mess_id: Number(messId), date, meal, status: 'open', note: null, items: [] };
    });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_MENU_GET',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}`,
      details: { ...getReqMeta(req), overrides: overrideRes.rows.length, returned: merged.length },
    });
    flowLog('MEALS MENU', 'Fetched', { mess_id: messId, date, overrides: overrideRes.rows.length });
    return res.json({ mess_id: messId, date, meals: merged });
  } catch (err) {
    console.error('[GET MENU] Error:', err.message);
    flowLog('MEALS MENU', 'Error', { mess_id: messId, date, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_MENU_GET_ERROR',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to fetch menu', err);
  }
});

// POST /meals/override
router.post('/override', authenticateToken, upsertDateOverride);

// DELETE /meals/override?mess_id=...&date=YYYY-MM-DD&meal_type=...
router.delete('/override', authenticateToken, async (req, res) => {
  const date = req.query.date;
  const meal = normalizeMeal(req.query.meal_type ?? req.query.meal);

  const messId = await resolveMessId({ messIdRaw: req.query.mess_id, hostelIdRaw: req.query.hostel_id });
  if (!messId || !date || !meal) {
    return res.status(400).json({ error: 'mess_id (or hostel_id), date, and meal_type are required as query params' });
  }

  try {
    flowLog('MEALS OVERRIDE', 'Delete request received', { mess_id: messId, date, meal_type: meal });
    const gate = await requireManagerForMess({ req, messId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const result = await pool.query(
      `DELETE FROM meal_calendars
       WHERE mess_id = $1 AND date = $2 AND meal = $3
       RETURNING mess_id, to_char(date::date, 'YYYY-MM-DD') AS date, meal`,
      [messId, date, meal]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Override not found' });
    }

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: gate.userId,
      action: 'MEALS_DATE_OVERRIDE_DELETE',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}:${meal}`,
      details: { ...getReqMeta(req) },
    });

    flowLog('MEALS OVERRIDE', 'Deleted', { mess_id: messId, date, meal_type: meal });
    return res.json({ success: true, message: 'Override removed', override: result.rows[0] });
  } catch (err) {
    console.error('[DELETE OVERRIDE] Error:', err.message);
    flowLog('MEALS OVERRIDE', 'Delete error', { mess_id: messId, date, meal_type: meal, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_DATE_OVERRIDE_DELETE_ERROR',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}:${meal}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to delete override', err);
  }
});

// Backward-compatible alias.
router.post('/menu', authenticateToken, upsertDateOverride);

// Remove an item from a meal's items list (manager only)
router.delete('/menu/item', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const date = req.body?.date;
  const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
  const item = req.body?.item;

  const messId = await resolveMessId({ messIdRaw: req.body?.mess_id, hostelIdRaw: req.body?.hostel_id });
  if (!messId || !date || !meal || !item) {
    return res.status(400).json({ error: 'mess_id (or hostel_id), date, meal_type, and item are required' });
  }

  try {
    flowLog('MEALS MENU', 'Delete item request received', { mess_id: messId, date, meal_type: meal, item: mask(item) });
    const gate = await requireManagerForMess({ req, messId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const existing = await pool.query(
      'SELECT items FROM meal_calendars WHERE mess_id = $1 AND date = $2 AND meal = $3',
      [messId, date, meal]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Meal not found' });

    const currentItems = Array.isArray(existing.rows[0].items) ? existing.rows[0].items : [];
    const updatedItems = currentItems.filter(i => i !== item);

    await pool.query(
      'UPDATE meal_calendars SET items = $1, updated_at = now() WHERE mess_id = $2 AND date = $3 AND meal = $4',
      [JSON.stringify(updatedItems), messId, date, meal]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'MEALS_MENU_DELETE_ITEM',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}:${meal}`,
      details: { ...getReqMeta(req), item, items_count: updatedItems.length },
    });
    flowLog('MEALS MENU', 'Item deleted', { mess_id: messId, date, meal_type: meal, items_count: updatedItems.length });
    return res.json({ success: true, items: updatedItems });
  } catch (err) {
    console.error('[DELETE MENU ITEM] Error:', err.message);
    flowLog('MEALS MENU', 'Delete item error', { mess_id: messId, date, meal_type: meal, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'MEALS_MENU_DELETE_ITEM_ERROR',
      entityType: 'meal_calendar',
      entityId: `${messId}:${date}:${meal}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to delete item', err);
  }
});

module.exports = router;
