function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = requireRole;
