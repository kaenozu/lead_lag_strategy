'use strict';

const path = require('path');
const fs = require('fs/promises');

async function readJsonLines(filePath, limit = 200) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

function registerOpsRoutes(app, deps) {
  const {
    config,
    logger,
    ensureRole,
    writeAudit,
    AUDIT_PATH,
    sendNotification,
    buildExecutionPlan,
    inverseVolAllocation,
    explainSignals,
    assessDataQuality,
    fetchMarketDataForTickers,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    runtimeState
  } = deps;

  app.get('/api/presets', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
    const presets = Object.keys(config.operations.profiles || {}).map((name) => ({
      name,
      values: config.operations.profiles[name]
    }));
    res.json({ active: config.operations.activePreset, presets });
  });

  app.post('/api/presets/apply', ensureRole(['trader', 'admin']), (req, res) => {
    const name = String(req.body?.name || '').trim().toLowerCase();
    const preset = config.operations.profiles?.[name];
    if (!preset) {
      return res.status(400).json({
        error: 'Unknown preset',
        available: Object.keys(config.operations.profiles || {})
      });
    }

    config.backtest.windowLength = Number(preset.windowLength);
    config.backtest.lambdaReg = Number(preset.lambdaReg);
    config.backtest.quantile = Number(preset.quantile);
    config.backtest.stability.maxPositionAbs = Number(preset.maxPositionAbs);
    config.backtest.stability.maxGrossExposure = Number(preset.maxGrossExposure);
    config.backtest.stability.dailyLossStop = Number(preset.dailyLossStop || 0);
    config.operations.activePreset = name;

    writeAudit('preset.apply', {
      role: req.role,
      preset: name
    });
    res.json({
      ok: true,
      active: name,
      config: {
        windowLength: config.backtest.windowLength,
        lambdaReg: config.backtest.lambdaReg,
        quantile: config.backtest.quantile
      }
    });
  });

  app.get('/api/audit', ensureRole(['admin']), async (req, res) => {
    const limitRaw = parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
    const entries = await readJsonLines(AUDIT_PATH, limit);
    res.json({ entries });
  });

  app.get('/api/alerts', ensureRole(['viewer', 'trader', 'admin']), async (_req, res) => {
    const p = path.resolve(config.data.outputDir, 'notifications.log');
    const alerts = await readJsonLines(p, 200);
    res.json({ alerts });
  });

  app.post('/api/notifications/test', ensureRole(['admin']), async (req, res) => {
    await sendNotification({
      channel: config.operations.notificationChannel,
      level: 'warn',
      message: String(req.body?.message || 'manual notification test'),
      context: { source: 'api/notifications/test' },
      config
    });
    writeAudit('notification.test', { role: req.role });
    res.json({ ok: true });
  });

  app.post('/api/execution/plan', ensureRole(['trader', 'admin']), (req, res) => {
    const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
    const cash = Number(req.body?.cash ?? config.trading.initialCapital);
    const plan = buildExecutionPlan(signals, {
      cash,
      lotSize: Number(req.body?.lotSize || 1),
      maxPerOrder: Number(req.body?.maxPerOrder || cash),
      minOrderValue: Number(req.body?.minOrderValue || 0)
    });
    writeAudit('execution.plan', { role: req.role, orders: plan.totalOrders });
    res.json(plan);
  });

  app.post('/api/allocation/inverse-vol', ensureRole(['trader', 'admin']), (req, res) => {
    const metricsByStrategy = req.body?.metricsByStrategy || {};
    const weights = inverseVolAllocation(metricsByStrategy);
    writeAudit('allocation.inverse_vol', { role: req.role, strategies: Object.keys(metricsByStrategy).length });
    res.json({ weights });
  });

  app.post('/api/explain', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
    const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
    res.json(explainSignals(signals, Number(req.body?.topN || 5)));
  });

  app.get('/api/ops/data-quality', ensureRole(['trader', 'admin']), async (req, res) => {
    const daysRaw = parseInt(String(req.query.days || config.operations.dataQuality.lookbackDays), 10);
    const days = Number.isFinite(daysRaw) ? Math.max(30, Math.min(3000, daysRaw)) : config.operations.dataQuality.lookbackDays;
    const [usRes, jpRes] = await Promise.all([
      fetchMarketDataForTickers(US_ETF_TICKERS, days, config),
      fetchMarketDataForTickers(JP_ETF_TICKERS, days, config)
    ]);
    const quality = assessDataQuality({ ...usRes.byTicker, ...jpRes.byTicker });
    runtimeState.lastDataQuality = {
      at: new Date().toISOString(),
      ok: quality.ok,
      badTickers: quality.badTickers
    };
    if (!quality.ok) {
      await sendNotification({
        channel: config.operations.notificationChannel,
        level: 'warn',
        message: 'Data quality warning',
        context: { badTickers: quality.badTickers },
        config
      });
    }
    res.json(quality);
  });

  app.get('/api/ops/summary', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
    const latest = runtimeState.lastSignal || null;
    const anomalyCount = runtimeState.anomalies.length;
    const quality = runtimeState.lastDataQuality || null;
    res.json({
      latestSignalAt: latest?.at || null,
      anomalyCount,
      quality
    });
  });

  app.get('/api/anomalies', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
    res.json({ items: runtimeState.anomalies.slice(-500) });
  });
}

module.exports = {
  registerOpsRoutes
};
