'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { createLogger } = require('../../lib/logger');
const {
  config,
  getDataSourcesForUi,
  applyDataSourceSettings,
  getDataSourceUpdateErrors
} = require('../../lib/config');
const { LeadLagSignal } = require('../../lib/pca');
const {
  buildPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('../../lib/portfolio');
const { correlationMatrixSample } = require('../../lib/math');
const {
  fetchWithRetry,
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../../lib/constants');
const { riskPayload } = require('../../lib/disclosure');
const { summarizeSignalSourcePaths, buildOpsDecision } = require('../../lib/opsDecision');
const {
  isCsvDataMode,
  isAlreadyFullYahooPath,
  configForYahooDataRecovery
} = require('../../lib/data/sourceRecovery');
const { sendNotification } = require('../../lib/ops/notifier');
const { writeAudit, AUDIT_PATH } = require('../../lib/ops/audit');
const { ensureRole } = require('../../lib/ops/rbac');
const { assessDataQuality } = require('../../lib/ops/dataQuality');
const { buildExecutionPlan } = require('../../lib/ops/executionPlanner');
const { explainSignals } = require('../../lib/ops/explain');
const { inverseVolAllocation } = require('../../lib/ops/allocation');

const { createStrategyService } = require('./services/strategyService');
const { registerStrategyRoutes } = require('./routes/strategyRoutes');
const { registerSystemRoutes } = require('./routes/systemRoutes');
const { registerConfigRoutes } = require('./routes/configRoutes');
const { registerOpsRoutes } = require('./routes/opsRoutes');
const { validateBacktestParams, validateConfigUpdateParams } = require('./modules/paramValidation');
const { getUiConfigPayload, updateBacktestConfig } = require('./modules/configStore');

const logger = createLogger('Server');

function createApp() {
  const app = express();
  const runtimeState = {
    lastSignal: null,
    anomalies: [],
    lastDataQuality: null
  };

  function pushAnomaly(type, message, context = {}) {
    runtimeState.anomalies.push({
      at: new Date().toISOString(),
      type,
      message,
      context
    });
    if (runtimeState.anomalies.length > 500) runtimeState.anomalies.shift();
  }

  // API Key Auth
  const API_KEY = process.env.API_KEY;
  function apiKeyAuth(req, res, next) {
    if (!API_KEY) return next();
    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
      logger.warn('Unauthorized API access attempt', { ip: req.ip, path: req.path });
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
    next();
  }

  // Rate Limiting
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

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static('public'));

  // Dependencies for services and routes
  const deps = {
    config,
    logger,
    riskPayload,
    validateBacktestParams,
    validateConfigUpdateParams,
    fetchMarketDataForTickers: fetchOhlcvForTickers,
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
    fetchWithRetry,
    ensureRole,
    writeAudit,
    AUDIT_PATH,
    sendNotification,
    buildExecutionPlan,
    inverseVolAllocation,
    explainSignals,
    assessDataQuality,
    getDataSourcesForUi,
    getUiConfigPayload,
    getDataSourceUpdateErrors,
    applyDataSourceSettings,
    updateBacktestConfig,
    runtimeState,
    pushAnomaly
  };

  const strategyService = createStrategyService(deps);
  const routeDeps = { ...deps, strategyService };

  // Register Routes
  app.use('/api/', apiLimiter);
  app.use('/api/backtest', backtestLimiter);
  app.use('/api/backtest', apiKeyAuth);
  app.use('/api/signal', apiKeyAuth);

  registerStrategyRoutes(app, routeDeps);
  registerSystemRoutes(app, routeDeps);
  registerConfigRoutes(app, routeDeps);
  registerOpsRoutes(app, routeDeps);

  // Global Error Handling
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { error: err.message, path: req.path, method: req.method });
    const isDev = config.server.isDevelopment;
    res.status(500).json({
      error: 'Internal server error',
      message: isDev ? err.message : undefined,
      ...(isDev && { stack: err.stack })
    });
  });

  return app;
}

module.exports = { createApp };
