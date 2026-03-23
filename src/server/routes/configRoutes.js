'use strict';

function registerConfigRoutes(app, deps) {
  const {
    config,
    logger,
    riskPayload,
    getDataSourcesForUi,
    getUiConfigPayload,
    validateConfigUpdateParams,
    getDataSourceUpdateErrors,
    applyDataSourceSettings,
    updateBacktestConfig
  } = deps;

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(getUiConfigPayload({
      disclosure: riskPayload(),
      dataSources: getDataSourcesForUi()
    }));
  });

  app.post('/api/config', (req, res) => {
    const { windowLength, lambdaReg, quantile } = req.body;
    const dataMode = req.body.dataMode ?? req.body.mode;
    const usOhlcvProvider = req.body.usOhlcvProvider ?? req.body.us_ohlcv_provider;
    const errors = [];

    const validation = validateConfigUpdateParams({ windowLength, lambdaReg, quantile });
    errors.push(...validation.errors);

    errors.push(
      ...getDataSourceUpdateErrors({
        mode: dataMode,
        usOhlcvProvider
      })
    );

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid parameters', details: errors });
    }

    applyDataSourceSettings({
      mode: dataMode,
      usOhlcvProvider
    });
    updateBacktestConfig(validation.updates);

    logger.info('Configuration updated via API', {
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile,
      dataMode: config.data.mode,
      usOhlcvProvider: config.data.usOhlcvProvider
    });

    res.json(getUiConfigPayload({
      disclosure: riskPayload(),
      dataSources: getDataSourcesForUi()
    }));
  });
}

module.exports = {
  registerConfigRoutes
};

