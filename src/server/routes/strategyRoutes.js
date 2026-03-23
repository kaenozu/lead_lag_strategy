'use strict';

function registerStrategyRoutes(app, deps) {
  const { strategyService, logger, config } = deps;

  app.post('/api/backtest', async (req, res) => {
    try {
      const result = await strategyService.runBacktest(req.body);
      return res.status(result.status).json(result.data);
    } catch (error) {
      logger.error('Backtest failed', {
        error: error.message,
        path: '/api/backtest'
      });
      return res.status(500).json({
        error: config.server.isDevelopment ? error.message : 'Backtest failed'
      });
    }
  });

  app.post('/api/signal', async (req, res) => {
    try {
      const result = await strategyService.generateSignal(req.body);
      return res.status(result.status).json(result.data);
    } catch (error) {
      logger.error('Signal generation failed', {
        error: error.message,
        path: '/api/signal'
      });
      return res.status(500).json({
        error: config.server.isDevelopment ? error.message : 'Signal generation failed'
      });
    }
  });
}

module.exports = {
  registerStrategyRoutes
};

