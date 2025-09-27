const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    console.warn('[AUTH] No token provided');
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.warn('[AUTH] Invalid or expired token:', err.message);
      return res.sendStatus(403);
    }
    // Log user identity for both user and admin tokens
    const identity = user.email || user.username || user.adminId || user.role || 'unknown';
    console.log('[AUTH] Token valid for user:', identity);
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
