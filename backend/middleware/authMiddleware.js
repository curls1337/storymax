const jwt = require('jsonwebtoken');
// C2: JWT secret comes from centralised config (env-backed; required in prod).
const { JWT_SECRET } = require('../config/secrets');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ message: 'Invalid or expired token.' });
  }
}

// Variant for endpoints opened via plain browser navigation / window.open (e.g.
// file downloads on mobile), which cannot send an Authorization header. Accepts
// the JWT from the header OR a ?token= query param. The token must still be a
// valid, unexpired, correctly-signed JWT — so this is NOT an open proxy.
function authenticateTokenAllowQuery(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(403).json({ message: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden. Admin role required.' });
  }
  next();
}

module.exports = {
  authenticateToken,
  authenticateTokenAllowQuery,
  requireAdmin,
  JWT_SECRET,
};
