require('dotenv').config();
const express = require('express');
const pool = require('./config/db');

const app = express();
app.use(express.json());
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Request/response logs (console) with X-Request-Id.
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// Basic security headers (avoid extra dependencies).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// CORS support (restrict in production via CORS_ORIGINS).
app.use((req, res, next) => {
  const originsRaw = String(process.env.CORS_ORIGINS ?? '').trim();
  const origins = originsRaw
    ? originsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null;

  const origin = req.headers.origin;
  if (!origins || origins.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Routes
app.use('/user', require('./routes/user'));
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/meals', require('./routes/meals'));

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Backend is running' });
});

app.get('/ping', (req, res) => {
  res.status(200).json({ ok: true, message: 'pong' });
});

// Health check for load balancers / uptime monitors.
app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'db_unavailable' });
  }
});

// JSON 404 + error handler (avoid HTML errors for the Expo app).
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

// Graceful shutdown (important for Render/AWS/etc).
async function shutdown(signal) {
  try {
    console.log(`[SHUTDOWN] Received ${signal}, closing server...`);
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    console.log('[SHUTDOWN] Done');
    process.exit(0);
  } catch (err) {
    console.error('[SHUTDOWN] Error:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
