const jwt = require('jsonwebtoken');
const { flowLog } = require('../utils/flowLog');
const pool = require('../config/db');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decodedUser) => {
    if (err) {
      flowLog('AUTH', 'Token invalid or expired');
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    try {
      // Single-device enforcement (students only): reject old tokens when user logs in on a new device.
      if (decodedUser?.role === 'student' && decodedUser?.id) {
        const result = await pool.query('SELECT token_version FROM users WHERE id = $1 LIMIT 1', [decodedUser.id]);
        const dbVersion = result.rows?.[0]?.token_version;
        const jwtVersion = decodedUser?.token_version;
        if (dbVersion !== undefined && dbVersion !== null && jwtVersion !== dbVersion) {
          return res.status(401).json({ error: 'Signed out: logged in on another device' });
        }
      }

      req.user = decodedUser;
      flowLog('AUTH', 'Token valid for user', { email: decodedUser?.email, role: decodedUser?.role });
      return next();
    } catch (e) {
      flowLog('AUTH', 'Token check error', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = authenticateToken;
