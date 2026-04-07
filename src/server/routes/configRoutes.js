'use strict';

function buildConfigPayload(riskPayload, getDataSourcesForUi, getUiConfigPayload) {
  return getUiConfigPayload({
    disclosure: riskPayload(),
    dataSources: getDataSourcesForUi()
  });
}

function logConfigUpdate(logger, config) {
  logger.info('Configuration updated via API', {
    windowLength: config.backtest.windowLength,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    dataMode: config.data.mode,
    usOhlcvProvider: config.data.usOhlcvProvider
  });
}

function registerConfigRoutes(app, deps) {
  const {
    config,
    logger,
    riskPayload,
    getDataSourcesForUi,
    getUiConfigPayload,
    validateConfigUpdateParams,
    updateBacktestConfig,
    buildConfigUpdateSummary
  } = deps;

  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(buildConfigPayload(riskPayload, getDataSourcesForUi, getUiConfigPayload));
  });

  app.post('/api/config', (req, res) => {
    const body = req.body || {};
    const { windowLength, lambdaReg, quantile } = body;
    const validation = validateConfigUpdateParams({ windowLength, lambdaReg, quantile });

    if (validation.errors.length > 0) {
      return res.status(400).json({ error: 'Invalid parameters', details: validation.errors });
    }

    updateBacktestConfig(validation.updates);
    logConfigUpdate(logger, buildConfigUpdateSummary(config));
    res.json(buildConfigPayload(riskPayload, getDataSourcesForUi, getUiConfigPayload));
  });
}

module.exports = {
  registerConfigRoutes,
  buildConfigPayload,
  logConfigUpdate
};
