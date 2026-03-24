'use strict';

const fs = require('fs');
const path = require('path');

const AUDIT_PATH = path.join(__dirname, '..', '..', 'results', 'audit.log');

function ensureAuditDir() {
  const dir = path.dirname(AUDIT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeAudit(event, payload = {}) {
  ensureAuditDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload
  });
  fs.appendFileSync(AUDIT_PATH, `${line}\n`, 'utf8');
}

module.exports = {
  writeAudit,
  AUDIT_PATH
};
