const { Pool } = require('pg');


// Use Render's DATABASE_URL if available, fallback to local config
let pool;
// if (process.env.DATABASE_URL) {
//   console.log('Using Render DATABASE_URL for DB connection');
//   pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     ssl: { rejectUnauthorized: false },
//   });
// } else {
  console.log('Using local DB config');
  pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'meal_manager',
    password: process.env.PGPASSWORD || 'password',
    port: process.env.PGPORT || 5432,
    // ssl: { rejectUnauthorized: false },
  });
// }

module.exports = pool;
