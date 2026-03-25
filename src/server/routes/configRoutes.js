'use strict';

function registerConfigRoutes(app, deps) {
  const {
    config,
    logger,
    riskPayload,
    getDataSourcesForUi,
    getUiConfigPayload,
    validateConfigUpdateParams,
    updateBacktestConfig
  } = deps;

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(getUiConfigPayload({
      disclosure: riskPayload(),
      dataSources: getDataSourcesForUi()
    }));
  });

  /** データ取得（日本・米国）は起動時に自動決定。POST ではバックテスト用パラメータのみ変更可能 */
  app.post('/api/config', (req, res) => {
    const body = req.body || {};
    const { windowLength, lambdaReg, quantile } = body;
    const validation = validateConfigUpdateParams({ windowLength, lambdaReg, quantile });

    if (validation.errors.length > 0) {
      return res.status(400).json({ error: 'Invalid parameters', details: validation.errors });
    }

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
