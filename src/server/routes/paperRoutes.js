'use strict';

const fs = require('fs');
const path = require('path');
const { buildExecutionPlan } = require('../../../lib/ops/executionPlanner');
const { loadOperatingRules, saveOperatingRules } = require('../../../lib/ops/operatingRules');
const { ensureRole } = require('../../../lib/ops/rbac');

const FALLBACKS = {
  verification: {
    skipped: true,
    reason: 'paper_verification_status.json is unavailable. Run paper verification first.'
  },
  walkforward: {
    ok: false,
    message: 'walkforward_oc_summary.json is unavailable. Run paper:walkforward first.'
  },
  orderCsv: 'signal.json is unavailable.'
};

function outputPath(config, filename) {
  return path.join(path.resolve(config.data.outputDir), filename);
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function sendJsonFile(res, filePath, fallback) {
  res.json(readJsonFile(filePath, fallback));
}

function resolveCashAmount(rawCash, fallbackCash) {
  const parsed = Number.parseFloat(String(rawCash ?? fallbackCash));
  if (Number.isFinite(parsed)) return parsed;
  return Number(fallbackCash) || 0;
}

function buildOrderCsv(signalDoc, cash) {
  const longs = signalDoc.buyCandidates || [];
  const plan = buildExecutionPlan(longs, { cash, lotSize: 100, maxPerOrder: cash });
  const lines = ['Side,Ticker,Qty,EstValue,RefPrice'];
  for (const item of plan.items) {
    lines.push(`${item.side},${item.ticker},${item.qty},${item.value.toFixed(0)},${item.price}`);
  }
  return lines.join('\n');
}

function registerPaperRoutes(app, deps) {
  const { config, writeAudit, logger } = deps;

  app.get('/api/paper/verification', (_req, res) => {
    const filePath = outputPath(config, 'paper_verification_status.json');
    sendJsonFile(res, filePath, FALLBACKS.verification);
  });

  app.get('/api/walkforward/summary', (_req, res) => {
    const filePath = outputPath(config, 'walkforward_oc_summary.json');
    sendJsonFile(res, filePath, FALLBACKS.walkforward);
  });

  app.get('/api/operating-rules', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
    const { path: rulesPath, rules } = loadOperatingRules(config);
    res.json({ path: rulesPath, rules });
  });

  app.put('/api/operating-rules', ensureRole(['admin']), (req, res) => {
    try {
      const rulesPath = saveOperatingRules(config, req.body || {});
      writeAudit('operating_rules.save', { path: rulesPath });
      res.json({ ok: true, path: rulesPath });
    } catch (error) {
      logger.error('operating rules save failed', { error: error.message });
      res.status(500).json({ error: 'save failed' });
    }
  });

  app.get('/api/paper/order-csv', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
    const cash = resolveCashAmount(req.query.cash, config.trading.initialCapital);
    const signalPath = outputPath(config, 'signal.json');

    try {
      const signalDoc = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
      const csv = buildOrderCsv(signalDoc, cash);
      const inline = String(req.query.inline || '') === '1';

      if (inline) {
        return res.type('text/plain; charset=utf-8').send(csv);
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="order_plan.csv"');
      res.send(csv);
    } catch {
      res.status(404).type('text/plain; charset=utf-8').send(FALLBACKS.orderCsv);
    }
  });
}

module.exports = {
  registerPaperRoutes,
  outputPath,
  readJsonFile,
  buildOrderCsv,
  resolveCashAmount
};
