'use strict';

const ALLOWED_ROLES = new Set(['admin', 'trader', 'viewer']);

function roleFromHeaders(headers = {}) {
  const key = headers['x-role'] || headers['x-user-role'] || '';
  const raw = String(key).toLowerCase().trim();
  if (ALLOWED_ROLES.has(raw)) return raw;
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
