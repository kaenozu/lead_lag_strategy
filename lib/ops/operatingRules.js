'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function examplePath() {
  return path.join(ROOT, 'config', 'operating-rules.example.json');
}

function loadExample() {
  try {
    return JSON.parse(fs.readFileSync(examplePath(), 'utf8'));
  } catch {
    return { version: 1, customLines: [] };
  }
}

function resolveRulesPath(cfg) {
  const custom = String(cfg?.operations?.operatingRulesPath || '').trim();
  if (custom) return path.resolve(custom);
  return path.resolve(cfg.data.outputDir, 'operating-rules.json');
}

function loadOperatingRules(cfg) {
  const ex = loadExample();
  const p = resolveRulesPath(cfg);
  try {
    const user = JSON.parse(fs.readFileSync(p, 'utf8'));
    const merged = {
      ...ex,
      ...user,
      customLines: Array.isArray(user.customLines) ? user.customLines : ex.customLines
    };
    return { path: p, rules: merged };
  } catch {
    return {
      path: p,
      rules: { ...ex, _note: 'ユーザファイルなし（例のみ表示）。results/operating-rules.json に保存できます。' }
    };
  }
}

function saveOperatingRules(cfg, body) {
  const p = resolveRulesPath(cfg);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(body, null, 2), 'utf8');
  return p;
}

module.exports = {
  loadOperatingRules,
  saveOperatingRules,
  resolveRulesPath,
  loadExample
};
