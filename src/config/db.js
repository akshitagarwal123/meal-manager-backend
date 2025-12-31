const { Pool, types } = require('pg');

// Avoid timezone confusion: treat Postgres DATE (OID 1082) as a plain YYYY-MM-DD string.
// Without this, some environments parse DATE into a JS Date at UTC midnight, which can show as the previous day in IST.
types.setTypeParser(1082, value => value);

function safeDbTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    return `${u.protocol}//${u.username ? '***' : ''}@${u.host}${u.pathname}`;
  } catch {
    return 'unparseable_DATABASE_URL';
  }
}

// Use Render's DATABASE_URL if available, fallback to local config
let pool;
if (process.env.DATABASE_URL) {
  console.log(`Using DATABASE_URL for DB connection (${safeDbTarget(process.env.DATABASE_URL)})`);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  const host = process.env.PGHOST || 'localhost';
  const useSsl =
    process.env.PGSSL === 'true' ||
    process.env.PGSSLMODE === 'require' ||
    !['localhost', '127.0.0.1'].includes(host);

  console.log(`Using DB config (host=${host}, ssl=${useSsl ? 'on' : 'off'})`);
  pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host,
    database: process.env.PGDATABASE || 'meal_manager',
    password: process.env.PGPASSWORD || 'password',
    port: process.env.PGPORT || 5432,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

module.exports = pool;
