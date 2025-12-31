const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const { getISTDateString } = require('../utils/date');
const { writeAuditLog, getReqMeta } = require('../utils/audit');
const { flowLog, mask } = require('../utils/flowLog');
const { respondServerError } = require('../utils/http');

const router = express.Router();

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'];

function normalizeMeal(value) {
  const normalized = String(value || '').toLowerCase();
  return MEAL_TYPES.includes(normalized) ? normalized : null;
}

async function getManagerHostelId({ userId, date }) {
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

function parseDayOfWeek(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0 || i > 6) return null;
  return i;
}

async function requireManagerForHostel({ req, hostelId }) {
  const userId = req.user?.id;
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (req.user?.role !== 'manager') return { ok: false, status: 403, error: 'Forbidden' };

  const today = getISTDateString();
  const assignedHostel = await getManagerHostelId({ userId, date: today });
  if (!assignedHostel || String(assignedHostel) !== String(hostelId)) {
    return { ok: false, status: 403, error: 'Manager not assigned to this hostel' };
  }
  return { ok: true, userId, assignedHostel };
}

async function upsertDateOverride(req, res) {
  const hostelId = req.body?.hostel_id;
  const date = req.body?.date;
  const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
  const status = String(req.body?.status || 'open').toLowerCase();
  const note = req.body?.note ? String(req.body.note) : null;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!hostelId || !date || !meal) return res.status(400).json({ error: 'hostel_id, date, and meal_type are required' });
  if (!['open', 'holiday'].includes(status)) return res.status(400).json({ error: 'status must be open or holiday' });

  try {
    flowLog('MEALS OVERRIDE', 'Request received', { hostel_id: hostelId, date, meal_type: meal });
    const gate = await requireManagerForHostel({ req, hostelId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const result = await pool.query(
      `INSERT INTO meal_calendars (hostel_id, date, meal, status, note, items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (hostel_id, date, meal)
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, items = EXCLUDED.items, updated_at = now()
       RETURNING hostel_id, to_char(date::date, 'YYYY-MM-DD') AS date, meal, status, note, items, updated_at`,
      [hostelId, date, meal, status, note, JSON.stringify(items)]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: gate.userId,
      action: 'MEALS_DATE_OVERRIDE_UPSERT',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req), status, items_count: items.length, note: note ? true : false },
    });

    flowLog('MEALS OVERRIDE', 'Saved', { hostel_id: hostelId, date, meal_type: meal, status, items_count: items.length });
    return res.json({ success: true, override: result.rows[0] });
  } catch (err) {
    console.error('[UPSERT DATE OVERRIDE] Error:', err.message);
    flowLog('MEALS OVERRIDE', 'Error', { hostel_id: hostelId, date, meal_type: meal, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_DATE_OVERRIDE_UPSERT_ERROR',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to save override', err);
  }
}

// Admin/manager-only: upsert weekly menu template row (hostel + day_of_week + meal).
// POST /meals/template
router.post('/template', authenticateToken, async (req, res) => {
  const hostelId = req.body?.hostel_id;
  const dayOfWeek = parseDayOfWeek(req.body?.day_of_week);
  const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
  const status = String(req.body?.status || 'open').toLowerCase();
  const note = req.body?.note ? String(req.body.note) : null;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!hostelId || dayOfWeek === null || !meal) {
    return res.status(400).json({ error: 'hostel_id, day_of_week (0-6), and meal_type are required' });
  }
  if (!['open', 'holiday'].includes(status)) return res.status(400).json({ error: 'status must be open or holiday' });

  try {
    flowLog('MEALS TEMPLATE', 'Upsert request received', { hostel_id: hostelId, day_of_week: dayOfWeek, meal_type: meal });
    const gate = await requireManagerForHostel({ req, hostelId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const result = await pool.query(
      `INSERT INTO hostel_weekly_menus (hostel_id, day_of_week, meal, status, note, items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (hostel_id, day_of_week, meal)
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, items = EXCLUDED.items, updated_at = now()
       RETURNING hostel_id, day_of_week, meal, status, note, items, updated_at`,
      [hostelId, dayOfWeek, meal, status, note, JSON.stringify(items)]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: gate.userId,
      action: 'MEALS_TEMPLATE_UPSERT',
      entityType: 'hostel_weekly_menu',
      entityId: `${hostelId}:${dayOfWeek}:${meal}`,
      details: { ...getReqMeta(req), status, items_count: items.length, note: note ? true : false },
    });

    flowLog('MEALS TEMPLATE', 'Saved', { hostel_id: hostelId, day_of_week: dayOfWeek, meal_type: meal, status, items_count: items.length });
    return res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error('[UPSERT TEMPLATE] Error:', err.message);
    flowLog('MEALS TEMPLATE', 'Error', { hostel_id: hostelId, day_of_week: dayOfWeek, meal_type: meal, error: err?.message || String(err) });
    return respondServerError(res, req, 'Failed to save weekly template', err);
  }
});

// Admin/manager-only: get weekly template for a hostel (optionally a specific day_of_week).
// GET /meals/template?hostel_id=1&day_of_week=0
router.get('/template', authenticateToken, async (req, res) => {
  const hostelId = req.query.hostel_id;
  const dayOfWeek = req.query.day_of_week !== undefined ? parseDayOfWeek(req.query.day_of_week) : null;
  if (!hostelId) return res.status(400).json({ error: 'hostel_id is required' });
  if (req.query.day_of_week !== undefined && dayOfWeek === null) return res.status(400).json({ error: 'day_of_week must be 0-6' });

  try {
    flowLog('MEALS TEMPLATE', 'Fetch request received', { hostel_id: hostelId, day_of_week: dayOfWeek ?? 'all' });
    const gate = await requireManagerForHostel({ req, hostelId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const params = [hostelId];
    let where = 'WHERE hostel_id = $1';
    if (dayOfWeek !== null) {
      params.push(dayOfWeek);
      where += ` AND day_of_week = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT hostel_id, day_of_week, meal, status, note, items, updated_at
       FROM hostel_weekly_menus
       ${where}
       ORDER BY day_of_week ASC, meal ASC`,
      params
    );

    flowLog('MEALS TEMPLATE', 'Fetched', { hostel_id: hostelId, count: result.rows.length });
    return res.json({ success: true, hostel_id: hostelId, templates: result.rows });
  } catch (err) {
    console.error('[GET TEMPLATE] Error:', err.message);
    flowLog('MEALS TEMPLATE', 'Error', { hostel_id: hostelId, error: err?.message || String(err) });
    return respondServerError(res, req, 'Failed to fetch weekly template', err);
  }
});

// Read-only menu for a hostel + date
// GET /meals/menu?hostel_id&date=YYYY-MM-DD
router.get('/menu', authenticateToken, async (req, res) => {
  const hostelId = req.query.hostel_id;
  const date = req.query.date;
  if (!hostelId || !date) return res.status(400).json({ error: 'hostel_id and date are required as query params' });

  try {
    flowLog('MEALS MENU', 'Fetch request received', { hostel_id: hostelId, date });
    const overrideRes = await pool.query(
      `SELECT hostel_id, to_char(date::date, 'YYYY-MM-DD') AS date, meal, status, note, items
       FROM meal_calendars
       WHERE hostel_id = $1 AND date = $2
       ORDER BY meal ASC`,
      [hostelId, date]
    );
    const overrides = new Map(overrideRes.rows.map(r => [r.meal, r]));

    const templateRes = await pool.query(
      `SELECT meal, status, note, items
       FROM hostel_weekly_menus
       WHERE hostel_id = $1
         AND day_of_week = EXTRACT(DOW FROM $2::date)::int
       ORDER BY meal ASC`,
      [hostelId, date]
    );
    const templates = new Map(templateRes.rows.map(r => [r.meal, r]));

    const merged = MEAL_TYPES.map(meal => {
      const override = overrides.get(meal);
      if (override) return override;
      const template = templates.get(meal);
      if (template) {
        return {
          hostel_id: Number(hostelId),
          date,
          meal,
          status: template.status,
          note: template.note,
          items: template.items,
        };
      }
      return { hostel_id: Number(hostelId), date, meal, status: 'open', note: null, items: [] };
    });

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_MENU_GET',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}`,
      details: { ...getReqMeta(req), overrides: overrideRes.rows.length, returned: merged.length },
    });
    flowLog('MEALS MENU', 'Fetched', { hostel_id: hostelId, date, overrides: overrideRes.rows.length });
    return res.json({ hostel_id: hostelId, date, meals: merged });
  } catch (err) {
    console.error('[GET MENU] Error:', err.message);
    flowLog('MEALS MENU', 'Error', { hostel_id: hostelId, date, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_MENU_GET_ERROR',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to fetch menu', err);
  }
});

// Date-specific override (exceptions) for a hostel/date/meal (manager only).
// POST /meals/override  (preferred)
router.post('/override', authenticateToken, upsertDateOverride);

// Delete a date-specific override so reads fall back to weekly template (manager only).
// DELETE /meals/override?hostel_id=<id>&date=YYYY-MM-DD&meal_type=<breakfast|lunch|snacks|dinner>
router.delete('/override', authenticateToken, async (req, res) => {
  const hostelId = req.query.hostel_id;
  const date = req.query.date;
  const meal = normalizeMeal(req.query.meal_type ?? req.query.meal);

  if (!hostelId || !date || !meal) {
    return res.status(400).json({ error: 'hostel_id, date, and meal_type are required as query params' });
  }

  try {
    flowLog('MEALS OVERRIDE', 'Delete request received', { hostel_id: hostelId, date, meal_type: meal });
    const gate = await requireManagerForHostel({ req, hostelId });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const result = await pool.query(
      `DELETE FROM meal_calendars
       WHERE hostel_id = $1 AND date = $2 AND meal = $3
       RETURNING hostel_id, to_char(date::date, 'YYYY-MM-DD') AS date, meal`,
      [hostelId, date, meal]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Override not found' });
    }

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: gate.userId,
      action: 'MEALS_DATE_OVERRIDE_DELETE',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req) },
    });

    flowLog('MEALS OVERRIDE', 'Deleted', { hostel_id: hostelId, date, meal_type: meal });
    return res.json({ success: true, message: 'Override removed', override: result.rows[0] });
  } catch (err) {
    console.error('[DELETE OVERRIDE] Error:', err.message);
    flowLog('MEALS OVERRIDE', 'Delete error', { hostel_id: hostelId, date, meal_type: meal, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'MEALS_DATE_OVERRIDE_DELETE_ERROR',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to delete override', err);
  }
});

// Backward-compatible alias (older clients).
// POST /meals/menu
router.post('/menu', authenticateToken, upsertDateOverride);

// Remove an item from a meal's items list (manager only)
router.delete('/menu/item', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const hostelId = req.body?.hostel_id;
  const date = req.body?.date;
  const meal = normalizeMeal(req.body?.meal_type ?? req.body?.meal);
  const item = req.body?.item;
  if (!hostelId || !date || !meal || !item) {
    return res.status(400).json({ error: 'hostel_id, date, meal_type, and item are required' });
  }

  try {
    flowLog('MEALS MENU', 'Delete item request received', { hostel_id: hostelId, date, meal_type: meal, item: mask(item) });
    const today = getISTDateString();
    const assignedHostel = await getManagerHostelId({ userId, date: today });
    if (!assignedHostel || String(assignedHostel) !== String(hostelId)) {
      return res.status(403).json({ error: 'Manager not assigned to this hostel' });
    }

    const existing = await pool.query(
      'SELECT items FROM meal_calendars WHERE hostel_id = $1 AND date = $2 AND meal = $3',
      [hostelId, date, meal]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Meal not found' });

    const currentItems = Array.isArray(existing.rows[0].items) ? existing.rows[0].items : [];
    const updatedItems = currentItems.filter(i => i !== item);

    await pool.query(
      'UPDATE meal_calendars SET items = $1, updated_at = now() WHERE hostel_id = $2 AND date = $3 AND meal = $4',
      [JSON.stringify(updatedItems), hostelId, date, meal]
    );

    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'MEALS_MENU_DELETE_ITEM',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req), item, items_count: updatedItems.length },
    });
    flowLog('MEALS MENU', 'Item deleted', { hostel_id: hostelId, date, meal_type: meal, items_count: updatedItems.length });
    return res.json({ success: true, items: updatedItems });
  } catch (err) {
    console.error('[DELETE MENU ITEM] Error:', err.message);
    flowLog('MEALS MENU', 'Delete item error', { hostel_id: hostelId, date, meal_type: meal, error: err?.message || String(err) });
    await writeAuditLog({
      collegeId: req.user?.college_id ?? null,
      actorUserId: userId,
      action: 'MEALS_MENU_DELETE_ITEM_ERROR',
      entityType: 'meal_calendar',
      entityId: `${hostelId}:${date}:${meal}`,
      details: { ...getReqMeta(req), error: err?.message || String(err) },
    });
    return respondServerError(res, req, 'Failed to delete item', err);
  }
});

module.exports = router;
