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
    console.log('[AUTH] Token valid for user:', user.email || user.username);
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
