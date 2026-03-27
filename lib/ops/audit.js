'use strict';

const fs = require('fs');
const path = require('path');

const AUDIT_PATH = path.join(__dirname, '..', '..', 'results', 'audit.log');

let pendingWrites = [];
let flushScheduled = false;

function ensureAuditDir() {
  const dir = path.dirname(AUDIT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeAudit(event, payload = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload
  });
  pendingWrites.push(line);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(flushWrites);
  }
}

function flushWrites() {
  if (pendingWrites.length === 0) {
    flushScheduled = false;
    return;
  }
  const lines = pendingWrites;
  pendingWrites = [];
  flushScheduled = false;
  ensureAuditDir();
  fs.appendFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf8', (err) => {
    if (err) {
      process.stderr.write(`audit write failed: ${err.message}\n`);
      pendingWrites = lines.concat(pendingWrites);
      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(flushWrites);
      }
    }
  });
}

module.exports = {
  writeAudit,
  AUDIT_PATH
};
