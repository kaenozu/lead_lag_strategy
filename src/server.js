/**
 * 日米業種リードラグ戦略 - Web バックテストサーバー
 */
'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { createLogger } = require('../lib/logger');
const {
  config,
  validate,
  getDataSourcesForUi,
  applyDataSourceSettings,
  getDataSourceUpdateErrors
} = require('../lib/config');
const { riskPayload } = require('../lib/disclosure');
const { summarizeSignalSourcePaths, buildOpsDecision } = require('../lib/opsDecision');
const { fetchWithRetry, buildReturnMatricesFromOhlcv } = require('../lib/data');
const { fetchMarketDataForTickers } = require('../lib/data/providerAdapter');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');
const { correlationMatrixSample } = require('../lib/math');
const { LeadLagSignal } = require('../lib/pca');
const {
  buildPortfolio,
  applyTransactionCosts,
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('../lib/portfolio');
const {
  isCsvDataMode,
  isAlreadyFullYahooPath,
  configForYahooDataRecovery
} = require('../lib/data/sourceRecovery');
const {
  validateBacktestParams,
  validateConfigUpdateParams
} = require('./server/modules/paramValidation');
const { getUiConfigPayload, updateBacktestConfig } = require('./server/modules/configStore');
const { createStrategyService } = require('./server/services/strategyService');
const { registerStrategyRoutes } = require('./server/routes/strategyRoutes');
const { registerConfigRoutes } = require('./server/routes/configRoutes');
const { registerSystemRoutes } = require('./server/routes/systemRoutes');

const logger = createLogger('Server');
const app = express();

if (config.server.trustProxy) app.set('trust proxy', config.server.trustProxy);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip)
});
const backtestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Backtest requests are rate-limited to 10 per 5 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip)
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use('/api/', apiLimiter);
app.use('/api/backtest', backtestLimiter);

const configErrors = validate();
if (configErrors.length > 0) {
  logger.warn('Configuration warnings', { warnings: configErrors });
}

const strategyService = createStrategyService({
  config,
  logger,
  riskPayload,
  validateBacktestParams,
  fetchMarketDataForTickers,
  buildReturnMatricesFromOhlcv,
  US_ETF_TICKERS,
  JP_ETF_TICKERS,
  JP_ETF_NAMES,
  isCsvDataMode,
  isAlreadyFullYahooPath,
  configForYahooDataRecovery,
  correlationMatrixSample,
  LeadLagSignal,
  buildPortfolio,
  applyTransactionCosts,
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics,
  summarizeSignalSourcePaths,
  buildOpsDecision,
  fetchWithRetry
});

registerStrategyRoutes(app, { strategyService, logger, config });
registerConfigRoutes(app, {
  config,
  logger,
  riskPayload,
  getDataSourcesForUi,
  getUiConfigPayload,
  validateConfigUpdateParams,
  getDataSourceUpdateErrors,
  applyDataSourceSettings,
  updateBacktestConfig
});

registerSystemRoutes(app, { riskPayload });

// ============================================
// エラーハンドリング（全ルートの後）
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    path: req.path,
    method: req.method
  });

  const isDev = config.server.isDevelopment;
  res.status(500).json({
    error: 'Internal server error',
    message: isDev ? err.message : undefined,
    ...(isDev && { stack: err.stack })
  });
});

// ============================================
// サーバー起動
// ============================================

const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, env: config.server.env });
  logger.info('API endpoints:', {
    'POST /api/backtest': 'Run backtest',
    'POST /api/signal': 'Generate signal',
    'GET /api/config': 'Get configuration',
    'POST /api/config': 'Update configuration',
    'GET /api/disclosure': 'Risk disclaimer text',
    'GET /api/health': 'Health check'
  });
});
