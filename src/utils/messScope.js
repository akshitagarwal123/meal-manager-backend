const pool = require('../config/db');

const DEFAULT_MEAL_WINDOWS = [
  { meal: 'breakfast', start_time: '06:00', end_time: '09:00', grace_minutes: 0 },
  { meal: 'lunch', start_time: '13:00', end_time: '15:00', grace_minutes: 0 },
  { meal: 'snacks', start_time: '16:30', end_time: '18:00', grace_minutes: 0 },
  { meal: 'dinner', start_time: '19:30', end_time: '21:30', grace_minutes: 0 },
];

async function getMessIdForHostel(hostelId) {
  const result = await pool.query('SELECT mess_id FROM hostels WHERE id = $1', [hostelId]);
  return result.rows?.[0]?.mess_id ?? null;
}

async function getManagerMessId({ userId, date }) {
  const result = await pool.query(
    `SELECT h.mess_id
     FROM hostel_staff hs
     JOIN hostels h ON h.id = hs.hostel_id
     WHERE hs.user_id = $1
       AND hs.start_date <= $2
       AND (hs.end_date IS NULL OR hs.end_date >= $2)
     ORDER BY hs.start_date DESC
     LIMIT 1`,
    [userId, date]
  );
  return result.rows?.[0]?.mess_id ?? null;
}

async function getStudentMessId({ userId, date }) {
  const result = await pool.query(
    `SELECT h.mess_id
     FROM user_hostel_assignments uha
     JOIN hostels h ON h.id = uha.hostel_id
     WHERE uha.user_id = $1
       AND uha.start_date <= $2
       AND (uha.end_date IS NULL OR uha.end_date >= $2)
     ORDER BY uha.start_date DESC
     LIMIT 1`,
    [userId, date]
  );
  return result.rows?.[0]?.mess_id ?? null;
}

async function getMessMealWindow({ messId, meal }) {
  const result = await pool.query(
    `SELECT meal,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI') AS end_time,
            grace_minutes
     FROM mess_meal_windows
     WHERE mess_id = $1 AND meal = $2
     LIMIT 1`,
    [messId, meal]
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

async function getEffectiveMealStatus({ messId, date, meal }) {
  const override = await pool.query(
    `SELECT status FROM meal_calendars
     WHERE mess_id = $1 AND date = $2::date AND meal = $3
     LIMIT 1`,
    [messId, date, meal]
  );
  if (override.rows.length) return String(override.rows[0].status || 'open');

  const template = await pool.query(
    `SELECT status FROM mess_weekly_menus
     WHERE mess_id = $1
       AND day_of_week = EXTRACT(DOW FROM $2::date)::int
       AND meal = $3
     LIMIT 1`,
    [messId, date, meal]
  );
  if (template.rows.length) return String(template.rows[0].status || 'open');
  return 'open';
}

module.exports = {
  DEFAULT_MEAL_WINDOWS,
  getMessIdForHostel,
  getManagerMessId,
  getStudentMessId,
  getMessMealWindow,
  getEffectiveMealStatus,
};
