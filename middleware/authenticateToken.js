const jwt = require('jsonwebtoken');
const { flowLog } = require('../utils/flowLog');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      flowLog('AUTH', 'Token invalid or expired');
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    flowLog('AUTH', 'Token valid for user', { email: user?.email, role: user?.role });
    next();
  });
}

module.exports = authenticateToken;
