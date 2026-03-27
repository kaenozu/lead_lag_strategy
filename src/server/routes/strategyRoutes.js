'use strict';

function sendStrategyResult(res, result) {
  return res.status(result.status).json(result.data);
}

function formatStrategyError(config, fallbackMessage, error) {
  return {
    error: config.server.isDevelopment ? error.message : fallbackMessage
  };
}

async function handleStrategyRoute({ logger, config, fallbackMessage, errorLabel, path, action }, req, res) {
  try {
    const result = await action(req.body);
    return sendStrategyResult(res, result);
  } catch (error) {
    logger.error(errorLabel, {
      error: error.message,
      path
    });
    return res.status(500).json(formatStrategyError(config, fallbackMessage, error));
  }
}

function registerStrategyRoutes(app, deps) {
  const { strategyService, logger, config } = deps;

  app.post('/api/backtest', async (req, res) => {
    return handleStrategyRoute({
      logger,
      config,
      fallbackMessage: 'Backtest failed',
      errorLabel: 'Backtest failed',
      path: '/api/backtest',
      action: strategyService.runBacktest
    }, req, res);
  });

  app.post('/api/signal', async (req, res) => {
    return handleStrategyRoute({
      logger,
      config,
      fallbackMessage: 'Signal generation failed',
      errorLabel: 'Signal generation failed',
      path: '/api/signal',
      action: strategyService.generateSignal
    }, req, res);
  });
}

module.exports = {
  registerStrategyRoutes,
  sendStrategyResult,
  formatStrategyError,
  handleStrategyRoute
};
