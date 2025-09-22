const { Pool } = require('pg');

console.log('DB config:', {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'meal_manager',
  port: process.env.PGPORT || 5432
});

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'meal_manager',
  password: process.env.PGPASSWORD || 'password',
  port: process.env.PGPORT || 5432,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;
