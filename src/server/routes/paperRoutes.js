'use strict';

const fs = require('fs');
const path = require('path');
const { buildExecutionPlan } = require('../../../lib/ops/executionPlanner');
const { loadOperatingRules, saveOperatingRules } = require('../../../lib/ops/operatingRules');
const { ensureRole } = require('../../../lib/ops/rbac');

function registerPaperRoutes(app, deps) {
  const { config, writeAudit, logger } = deps;

  app.get('/api/paper/verification', (_req, res) => {
    const p = path.join(path.resolve(config.data.outputDir), 'paper_verification_status.json');
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      res.json(data);
    } catch {
      res.json({
        skipped: true,
        reason: 'paper_verification_status.json がありません。npm run paper（シグナル後）を実行してください。'
      });
    }
  });

  app.get('/api/walkforward/summary', (_req, res) => {
    const p = path.join(path.resolve(config.data.outputDir), 'walkforward_oc_summary.json');
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      res.json({ ok: true, summary: data });
    } catch {
      res.json({
        ok: false,
        message:
          'walkforward_oc_summary.json がありません。npm run backtest:walkforward を実行すると生成されます。'
      });
    }
  });

  app.get('/api/operating-rules', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
    const { path: rulesPath, rules } = loadOperatingRules(config);
    res.json({ path: rulesPath, rules });
  });

  app.put('/api/operating-rules', ensureRole(['admin']), (req, res) => {
    try {
      const p = saveOperatingRules(config, req.body || {});
      writeAudit('operating_rules.save', { path: p });
      res.json({ ok: true, path: p });
    } catch (error) {
      logger.error('operating rules save failed', { error: error.message });
      res.status(500).json({ error: 'save failed' });
    }
  });

  app.get('/api/paper/order-csv', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
    const cash = parseFloat(String(req.query.cash || config.trading.initialCapital), 10);
    const signalPath = path.join(path.resolve(config.data.outputDir), 'signal.json');
    try {
      const doc = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
      const longs = doc.buyCandidates || [];
      const plan = buildExecutionPlan(longs, { cash, lotSize: 100, maxPerOrder: cash });
      const lines = ['Side,Ticker,Qty,EstValue,RefPrice'];
      for (const it of plan.items) {
        lines.push(`${it.side},${it.ticker},${it.qty},${it.value.toFixed(0)},${it.price}`);
      }
      const body = lines.join('\n');
      const inline = String(req.query.inline || '') === '1';
      if (inline) {
        return res.type('text/plain; charset=utf-8').send(body);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="order_plan.csv"');
      res.send(body);
    } catch {
      res.status(404).type('text/plain; charset=utf-8').send('signal.json が必要です（先にシグナル生成）。');
    }
  });
}

module.exports = { registerPaperRoutes };
