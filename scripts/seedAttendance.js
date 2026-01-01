#!/usr/bin/env node
/* eslint-disable no-console */
const { Pool } = require('pg');

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function fmtISTYmd(date) {
  // YYYY-MM-DD in Asia/Kolkata.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function addDaysUTC(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function getPoolFromEnv() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (use Render external/internal Postgres URL)');
  }
  // Render typically requires SSL; keep rejectUnauthorized=false for managed cert chains.
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

async function main() {
  const args = parseArgs(process.argv);

  const email = String(args.email || '').trim().toLowerCase();
  if (!email) throw new Error('--email is required');

  const hostelIdArg = args['hostel-id'] ? Number(args['hostel-id']) : null;
  const hostelCodeArg = args['hostel-code'] ? String(args['hostel-code']).trim() : null;
  if ((!hostelIdArg || !Number.isFinite(hostelIdArg)) && !hostelCodeArg) {
    throw new Error('--hostel-id or --hostel-code is required (e.g. --hostel-code AUROBINDO)');
  }

  const days = args.days ? Number(args.days) : 30;
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('--days must be between 1 and 365');

  const attendanceRate = args['attendance-rate'] ? Number(args['attendance-rate']) : 0.7;
  if (!Number.isFinite(attendanceRate) || attendanceRate < 0 || attendanceRate > 1) {
    throw new Error('--attendance-rate must be between 0 and 1');
  }

  const scannedByEmail = args['scanned-by-email'] ? String(args['scanned-by-email']).trim().toLowerCase() : null;
  const source = args.source ? String(args.source) : 'seed';

  const endDateYmd = args.end ? String(args.end) : fmtISTYmd(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateYmd)) throw new Error('--end must be YYYY-MM-DD');

  const backfillAssignment = String(args['backfill-assignment'] || '').toLowerCase();
  const shouldBackfillAssignment = backfillAssignment === '1' || backfillAssignment === 'true' || backfillAssignment === 'yes';

  // Use a stable seed so reruns generate similar patterns; still safe due to ON CONFLICT DO NOTHING.
  const seed = Math.abs(Array.from(email + String(hostelIdArg || hostelCodeArg) + endDateYmd).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7));
  const rand = mulberry32(seed);

  const pool = getPoolFromEnv();
  try {
    const userRes = await pool.query('SELECT id, email FROM users WHERE email = $1 LIMIT 1', [email]);
    if (userRes.rows.length === 0) throw new Error(`User not found for email: ${email}`);
    const userId = Number(userRes.rows[0].id);

    let scannedById = null;
    if (scannedByEmail) {
      const mgrRes = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [scannedByEmail]);
      if (mgrRes.rows.length === 0) throw new Error(`scanned-by user not found for email: ${scannedByEmail}`);
      scannedById = Number(mgrRes.rows[0].id);
    }

    // Resolve hostel and validate.
    const hostelRes = hostelIdArg
      ? await pool.query('SELECT id, hostel_code, name FROM hostels WHERE id = $1 LIMIT 1', [hostelIdArg])
      : await pool.query('SELECT id, hostel_code, name FROM hostels WHERE hostel_code = $1 LIMIT 1', [hostelCodeArg]);
    if (hostelRes.rows.length === 0) throw new Error(`Hostel not found for hostel_id=${hostelId}`);
    const hostelId = Number(hostelRes.rows[0].id);

    // Build date list: endDateYmd back (days-1).
    // We generate by starting at midnight UTC and formatting into IST; it’s fine since we only care about YYYY-MM-DD.
    const endUtc = new Date(`${endDateYmd}T00:00:00.000Z`);
    const startUtc = addDaysUTC(endUtc, -(days - 1));
    const startDateYmd = fmtISTYmd(startUtc);
    const dates = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = addDaysUTC(endUtc, -i);
      dates.push(fmtISTYmd(d));
    }

    // Optional: ensure the user is assigned to this hostel for the full range.
    if (shouldBackfillAssignment) {
      const activeAssignRes = await pool.query(
        `SELECT id, start_date
         FROM user_hostel_assignments
         WHERE user_id = $1 AND hostel_id = $2 AND end_date IS NULL
         ORDER BY start_date ASC
         LIMIT 1`,
        [userId, hostelId]
      );

      if (activeAssignRes.rows.length === 0) {
        await pool.query(
          `INSERT INTO user_hostel_assignments (user_id, hostel_id, start_date, reason)
           VALUES ($1, $2, $3::date, $4)
           ON CONFLICT DO NOTHING`,
          [userId, hostelId, startDateYmd, 'seedAttendance backfill']
        );
      } else {
        const currentStart = String(activeAssignRes.rows[0].start_date);
        if (currentStart > startDateYmd) {
          await pool.query(`UPDATE user_hostel_assignments SET start_date = $1::date WHERE id = $2`, [
            startDateYmd,
            activeAssignRes.rows[0].id,
          ]);
        }
      }
    }

    let inserted = 0;
    let skippedNotAssigned = 0;
    let skippedNotEligible = 0;

    for (const dateYmd of dates) {
      // Only insert if user is assigned to this hostel on that date.
      const assignedRes = await pool.query(
        `SELECT 1
         FROM user_hostel_assignments
         WHERE user_id = $1
           AND hostel_id = $2
           AND start_date <= $3::date
           AND (end_date IS NULL OR end_date >= $3::date)
         LIMIT 1`,
        [userId, hostelId, dateYmd]
      );
      if (assignedRes.rows.length === 0) {
        skippedNotAssigned += 1;
        continue;
      }

      // Only insert scans for meals that are eligible/open on that day.
      const statusRes = await pool.query(
        `WITH meal_types AS (
           SELECT * FROM (VALUES ('breakfast'::text), ('lunch'::text), ('snacks'::text), ('dinner'::text)) AS t(meal)
         )
         SELECT mt.meal,
                COALESCE(mc.status, twm.status, 'open') AS status
         FROM meal_types mt
         LEFT JOIN meal_calendars mc
           ON mc.hostel_id = $1 AND mc.date = $2::date AND mc.meal = mt.meal
         LEFT JOIN hostel_weekly_menus twm
           ON twm.hostel_id = $1
          AND twm.day_of_week = EXTRACT(DOW FROM $2::date)::int
          AND twm.meal = mt.meal`,
        [hostelId, dateYmd]
      );
      const statusByMeal = Object.fromEntries(statusRes.rows.map(r => [r.meal, r.status]));

      const rows = [];
      for (const meal of MEAL_TYPES) {
        if (String(statusByMeal[meal] || 'open') !== 'open') {
          skippedNotEligible += 1;
          continue;
        }
        if (rand() > attendanceRate) continue;
        rows.push({ date: dateYmd, meal });
      }
      if (rows.length === 0) continue;

      const values = [];
      const params = [];
      let p = 1;
      for (const row of rows) {
        params.push(userId, hostelId, row.date, row.meal, scannedById, source);
        values.push(`($${p++}, $${p++}, $${p++}::date, $${p++}, $${p++}, $${p++})`);
      }

      const q = `
        INSERT INTO attendance_scans (user_id, hostel_id, date, meal, scanned_by, source)
        VALUES ${values.join(', ')}
        ON CONFLICT (hostel_id, date, meal, user_id) DO NOTHING
      `;
      const r = await pool.query(q, params);
      inserted += r.rowCount || 0;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          user: { email, id: String(userId) },
          hostel_id: String(hostelId),
          hostel_code: hostelRes.rows[0].hostel_code,
          end: endDateYmd,
          start: startDateYmd,
          days,
          attendance_rate: attendanceRate,
          source,
          inserted_rows: inserted,
          skipped_days_not_assigned: skippedNotAssigned,
          skipped_meals_not_eligible: skippedNotEligible,
          backfill_assignment: shouldBackfillAssignment,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('seedAttendance error:', err?.message || String(err));
  process.exit(1);
});
