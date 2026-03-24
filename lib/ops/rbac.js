'use strict';

function roleFromHeaders(headers = {}) {
  const raw = String(headers['x-role'] || '').toLowerCase();
  if (raw === 'admin' || raw === 'trader' || raw === 'viewer') return raw;
  return 'viewer';
}

function ensureRole(allowedRoles) {
  return (req, res, next) => {
    const role = roleFromHeaders(req.headers);
    req.role = role;
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: 'Forbidden',
        required: allowedRoles,
        role
      });
    }
    next();
  };
}

module.exports = {
  roleFromHeaders,
  ensureRole
};
