/**
 * 日米業種リードラグ戦略 - Web バックテストサーバー
 * 銘柄選択シグナルをリアルタイムで生成
 */

'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
// ライブラリ
const { createLogger } = require('../lib/logger');
const {
  config,
  validate,
  getDataSourcesForUi,
  applyDataSourceSettings,
  getDataSourceUpdateErrors
} = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const {
  buildPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('../lib/portfolio');
const {
  correlationMatrixSample
} = require('../lib/math');
const {
  fetchWithRetry,
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');
const { riskPayload } = require('../lib/disclosure');
const { summarizeSignalSourcePaths, buildOpsDecision } = require('../lib/opsDecision');
const {
  isCsvDataMode,
  isAlreadyFullYahooPath,
  configForYahooDataRecovery
} = require('../lib/data/sourceRecovery');
const { sendNotification } = require('../lib/ops/notifier');
const { writeAudit, AUDIT_PATH } = require('../lib/ops/audit');
const { ensureRole } = require('../lib/ops/rbac');
const { assessDataQuality } = require('../lib/ops/dataQuality');
const { buildExecutionPlan } = require('../lib/ops/executionPlanner');
const { explainSignals } = require('../lib/ops/explain');
const { inverseVolAllocation } = require('../lib/ops/allocation');
const fs = require('fs');
const path = require('path');

const logger = createLogger('Server');

const app = express();
const runtimeState = {
  lastSignal: null,
  anomalies: [],
  lastDataQuality: null
};

function readAuditEntries(limit = 200) {
  const p = path.join(path.resolve(config.data.outputDir), 'audit.log');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}

// ============================================
// セキュリティ設定
// ============================================

// API キー認証（環境変数 API_KEY が設定されている場合のみ有効）
const API_KEY = process.env.API_KEY;

/**
 * API キー認証ミドルウェア
 * API_KEY が設定されている場合、X-API-Key ヘッダーを検証
 */
function apiKeyAuth(req, res, next) {
  if (!API_KEY) {
    // API_KEY が未設定の場合は認証をスキップ（開発モード）
    return next();
  }
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    logger.warn('Unauthorized API access attempt', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }
  next();
}

// レート制限：API エンドポイントごと
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分
  max: 30, // 1 分あたり最大 30 リクエスト
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip)
});

//  stricter rate limit for backtest endpoint
const backtestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 分
  max: 10, // 5 分あたり最大 10 リクエスト
  message: { error: 'Backtest requests are rate-limited to 10 per 5 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip)
});

// ============================================
// ミドルウェア
// ============================================

app.use(cors());
app.use(express.json({ limit: '1mb' })); // リクエストサイズ制限
app.use(express.static('public'));

// API エンドポイントに認証とレート制限を適用
app.use('/api/', apiLimiter);
app.use('/api/backtest', backtestLimiter);
app.use('/api/backtest', apiKeyAuth);
app.use('/api/signal', apiKeyAuth);

// 設定の検証
const configErrors = validate();
if (configErrors.length > 0) {
  logger.warn('Configuration warnings', { warnings: configErrors });
}

// ============================================
// 定数 (lib/constants.js からインポート済み)
// ============================================

// ============================================
// 入力検証ヘルパー
// ============================================

/**
 * リクエストパラメータを検証・サニタイズ
 */
function validateBacktestParams(body) {
  const errors = [];
  const params = {};

  // windowLength - 型チェック強化
  if (body.windowLength !== undefined) {
    if (typeof body.windowLength !== 'string' && typeof body.windowLength !== 'number') {
      errors.push('windowLength must be a number or string');
    } else {
      const val = parseInt(String(body.windowLength).trim(), 10);
      if (isNaN(val) || val < 10 || val > 500) {
        errors.push('windowLength must be between 10 and 500');
      } else {
        params.windowLength = val;
      }
    }
  }

  // lambdaReg - 型チェック強化
  if (body.lambdaReg !== undefined) {
    if (typeof body.lambdaReg !== 'string' && typeof body.lambdaReg !== 'number') {
      errors.push('lambdaReg must be a number or string');
    } else {
      const val = parseFloat(String(body.lambdaReg).trim());
      if (isNaN(val) || val < 0 || val > 1) {
        errors.push('lambdaReg must be between 0 and 1');
      } else {
        params.lambdaReg = val;
      }
    }
  }

  // quantile - 型チェック強化
  if (body.quantile !== undefined) {
    if (typeof body.quantile !== 'string' && typeof body.quantile !== 'number') {
      errors.push('quantile must be a number or string');
    } else {
      const val = parseFloat(String(body.quantile).trim());
      if (isNaN(val) || val <= 0 || val > 0.5) {
        errors.push('quantile must be between 0 and 0.5');
      } else {
        params.quantile = val;
      }
    }
  }

  // nFactors - 型チェック強化
  if (body.nFactors !== undefined) {
    if (typeof body.nFactors !== 'string' && typeof body.nFactors !== 'number') {
      errors.push('nFactors must be a number or string');
    } else {
      const val = parseInt(String(body.nFactors).trim(), 10);
      if (isNaN(val) || val < 1 || val > 10) {
        errors.push('nFactors must be between 1 and 10');
      } else {
        params.nFactors = val;
      }
    }
  }

  return { errors, params };
}

/**
 * 表示用メトリクスに変換
 */
function toDisplayMetrics(raw, dayCount) {
  return {
    AR: raw.AR * 100,
    RISK: raw.RISK * 100,
    RR: raw.RR,
    MDD: raw.MDD * 100,
    Total: (raw.Cumulative - 1) * 100,
    Days: dayCount
  };
}

// ============================================
// API Endpoints
// ============================================

/**
 * バックテスト API
 */
app.post('/api/backtest', async (req, res) => {
  try {
    // 入力検証
    const validation = validateBacktestParams(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        error: 'Invalid parameters',
        details: validation.errors
      });
    }

    const wl = validation.params.windowLength || config.backtest.windowLength;
    const backtestConfig = {
      windowLength: wl,
      nFactors: validation.params.nFactors || config.backtest.nFactors,
      lambdaReg: validation.params.lambdaReg !== undefined
        ? validation.params.lambdaReg
        : config.backtest.lambdaReg,
      quantile: validation.params.quantile || config.backtest.quantile,
      warmupPeriod: wl,
      orderedSectorKeys: config.pca.orderedSectorKeys
    };

    const costs = config.backtest.transactionCosts;
    const chartDays = config.backtest.chartCalendarDays;

    logger.info('Running backtest', {
      ...backtestConfig,
      chartCalendarDays: chartDays,
      costs
    });

    logger.info('Fetching US/JP ETF data (parallel)');
    const needDays = backtestConfig.warmupPeriod + 10;
    let [usRes, jpRes] = await Promise.all([
      fetchOhlcvForTickers(US_ETF_TICKERS, chartDays, config),
      fetchOhlcvForTickers(JP_ETF_TICKERS, chartDays, config)
    ]);
    let usData = usRes.byTicker;
    let jpData = jpRes.byTicker;
    for (const [ticker, err] of Object.entries(usRes.errors)) {
      logger.warn(`US data ${ticker}: ${err}`);
    }
    for (const [ticker, err] of Object.entries(jpRes.errors)) {
      logger.warn(`JP data ${ticker}: ${err}`);
    }

    let { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
      usData,
      jpData,
      US_ETF_TICKERS,
      JP_ETF_TICKERS,
      config.backtest.jpWindowReturn
    );

    logger.info(`Data loaded: ${dates.length} trading days`);

    let dataRecoveryAttempted = false;
    if (dates.length < needDays && !isCsvDataMode(config) && !isAlreadyFullYahooPath(config)) {
      dataRecoveryAttempted = true;
      logger.warn('Backtest: 揃った営業日が不足 → Yahoo 経路で自動再取得', {
        alignedDays: dates.length,
        needDays
      });
      const recoverCfg = configForYahooDataRecovery(config);
      [usRes, jpRes] = await Promise.all([
        fetchOhlcvForTickers(US_ETF_TICKERS, chartDays, recoverCfg),
        fetchOhlcvForTickers(JP_ETF_TICKERS, chartDays, recoverCfg)
      ]);
      usData = usRes.byTicker;
      jpData = jpRes.byTicker;
      for (const [ticker, err] of Object.entries(usRes.errors)) {
        logger.warn(`US data (recovery) ${ticker}: ${err}`);
      }
      for (const [ticker, err] of Object.entries(jpRes.errors)) {
        logger.warn(`JP data (recovery) ${ticker}: ${err}`);
      }
      ({ retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
        usData,
        jpData,
        US_ETF_TICKERS,
        JP_ETF_TICKERS,
        config.backtest.jpWindowReturn
      ));
      logger.info(`Data loaded after recovery: ${dates.length} trading days`);
    }

    // データ量チェック
    if (dates.length < needDays) {
      const usErrN = Object.keys(usRes.errors || {}).length;
      const jpErrN = Object.keys(jpRes.errors || {}).length;
      const retrySuffix = dataRecoveryAttempted
        ? ' サーバー側で Yahoo 経路への自動切替・再取得を試みましたが、まだ不足しています。'
        : '';
      return res.json({
        error: 'データが不足しています',
        detail:
          `揃った営業日が ${dates.length} 日（要 ${needDays} 日以上）。` +
          `チャート取得は ${chartDays} カレンダー日。米国/日本でエラー記録のある銘柄: ${usErrN} / ${jpErrN}。` +
          retrySuffix,
        metrics: { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0, Days: dates.length },
        disclosure: riskPayload()
      });
    }

    // C_full 計算（パフォーマンス最適化：対称性を利用）
    const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
      .map((r, i) => [...r.values, ...retJp[i].values]);
    const CFull = correlationMatrixSample(combined);

    // シグナル生成
    const signalGen = new LeadLagSignal(backtestConfig);
    const results = [];
    const equalWeightSeries = [];
    const momentumSeries = [];
    let prevWeights = null;
    let prevMomWeights = null;

    // バックテストループ（参照のみ使用：不要なコピーを削除）
    for (let i = backtestConfig.warmupPeriod; i < retJpOc.length; i++) {
      const start = i - backtestConfig.windowLength;
      const retUsWin = retUs.slice(start, i).map(r => r.values);
      const retJpWin = retJp.slice(start, i).map(r => r.values);
      const retUsLatest = retUs[i].values;

      const signal = signalGen.computeSignal(
        retUsWin,
        retJpWin,
        retUsLatest,
        config.sectorLabels,
        CFull
      );

      const weights = buildPortfolio(signal, backtestConfig.quantile);
      const retNext = retJpOc[i].values;
      const nJp = retNext.length;

      // ポートフォオリターン計算
      let stratRet = 0;
      for (let j = 0; j < weights.length; j++) {
        stratRet += weights[j] * retNext[j];
      }
      stratRet = applyTransactionCosts(stratRet, costs, prevWeights, weights);
      prevWeights = weights;

      results.push({
        date: retJpOc[i].date,
        return: stratRet
      });

      // 均等ウェイト（ベンチマーク）
      const eqRaw = retNext.reduce((s, x) => s + x, 0) / nJp;
      equalWeightSeries.push({ date: retJpOc[i].date, return: eqRaw });

      // モメンタム戦略
      const mom = new Array(nJp).fill(0);
      for (let j = i - backtestConfig.windowLength; j < i; j++) {
        for (let k = 0; k < nJp; k++) {
          mom[k] += retJp[j].values[k];
        }
      }
      for (let k = 0; k < nJp; k++) {
        mom[k] /= backtestConfig.windowLength;
      }
      const wMom = buildPortfolio(mom, backtestConfig.quantile);
      let momRet = 0;
      for (let j = 0; j < nJp; j++) {
        momRet += wMom[j] * retNext[j];
      }
      momRet = applyTransactionCosts(momRet, costs, prevMomWeights, wMom);
      prevMomWeights = wMom;
      momentumSeries.push({ date: retJpOc[i].date, return: momRet });
    }

    // パフォーマンス指標計算
    const returns = results.map(r => r.return);
    const mStrat = computePerformanceMetrics(returns);
    const mEq = computePerformanceMetrics(equalWeightSeries.map(r => r.return));
    const mMom = computePerformanceMetrics(momentumSeries.map(r => r.return));

    // ローリング分析
    const rollingWindow = config.backtest.rollingReportWindow;
    const rolling = computeRollingMetrics(results, rollingWindow);
    const rollingRR = rolling.map(x => x.RR);
    const rollingSummary = {
      window: rollingWindow,
      count: rolling.length,
      lastDate: rolling.length ? rolling[rolling.length - 1].date : null,
      lastRR: rolling.length ? rolling[rolling.length - 1].RR : null,
      minRR: rollingRR.length ? Math.min(...rollingRR) : null,
      maxRR: rollingRR.length ? Math.max(...rollingRR) : null,
      tail: rolling.slice(-5)
    };

    // 年別パフォーマンス
    const yearlyRaw = computeYearlyPerformance(results);
    const yearlyStrategy = {};
    for (const [y, m] of Object.entries(yearlyRaw)) {
      const dayCount = results.filter(r => r.date.startsWith(y)).length;
      yearlyStrategy[y] = toDisplayMetrics(m, dayCount);
    }

    const stratDays = returns.length;

    res.json({
      config: {
        ...backtestConfig,
        transactionCosts: costs,
        chartCalendarDays: chartDays,
        rollingReportWindow: rollingWindow
      },
      ...(dataRecoveryAttempted
        ? {
          dataRecoveryNote:
              '初回の取得では営業日が足りなかったため、自動で Yahoo 経路に切り替えて再取得し、この結果を表示しています。'
        }
        : {}),
      costsNote:
        '取引コストはターンオーバーに比例（初日のみ全建て相当）。デフォルト 0＝論文の無摩擦。' +
        'JP 業種均等はコストなしの単純平均 OC（比較用）。',
      results: results.slice(-200),
      metrics: {
        ...toDisplayMetrics(mStrat, stratDays),
        costsApplied: true,
        equalWeightJP: toDisplayMetrics(mEq, equalWeightSeries.length),
        momentum: toDisplayMetrics(mMom, momentumSeries.length)
      },
      yearlyStrategy,
      rollingSummary,
      disclosure: riskPayload()
    });

  } catch (error) {
    logger.error('Backtest failed', {
      error: error.message,
      stack: error.stack,
      path: '/api/backtest',
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      error: config.server.isDevelopment ? error.message : 'Backtest failed',
      code: config.server.isDevelopment ? error.code : undefined
    });
  }
});

/**
 * シグナル生成 API
 */
app.post('/api/signal', async (req, res) => {
  try {
    // 入力検証
    const validation = validateBacktestParams(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        error: 'Invalid parameters',
        details: validation.errors
      });
    }

    const signalConfig = {
      windowLength: validation.params.windowLength || config.backtest.windowLength,
      nFactors: validation.params.nFactors || config.backtest.nFactors,
      lambdaReg: validation.params.lambdaReg !== undefined
        ? validation.params.lambdaReg
        : config.backtest.lambdaReg,
      quantile: validation.params.quantile || config.backtest.quantile,
      orderedSectorKeys: config.pca.orderedSectorKeys
    };

    logger.info('Generating signal', signalConfig);

    // カレンダー日。日米アライメント＋全銘柄揃いで行が落ちるため余裕を持たせる
    const winDays = Math.max(280, signalConfig.windowLength + 160);

    let [usRes, jpRes] = await Promise.all([
      fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
      fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
    ]);
    let usData = usRes.byTicker;
    let jpData = jpRes.byTicker;
    for (const [ticker, err] of Object.entries({ ...usRes.errors, ...jpRes.errors })) {
      logger.warn(`Signal data ${ticker}: ${err}`);
    }

    let { retUs, retJp, dates } = buildReturnMatricesFromOhlcv(
      usData,
      jpData,
      US_ETF_TICKERS,
      JP_ETF_TICKERS,
      config.backtest.jpWindowReturn
    );

    let signalDataRecoveryAttempted = false;
    if (
      retUs.length < signalConfig.windowLength &&
      !isCsvDataMode(config) &&
      !isAlreadyFullYahooPath(config)
    ) {
      signalDataRecoveryAttempted = true;
      logger.warn('Signal: 揃った営業日が不足 → Yahoo 経路で自動再取得', {
        alignedDays: retUs.length,
        need: signalConfig.windowLength
      });
      const recoverCfg = configForYahooDataRecovery(config);
      [usRes, jpRes] = await Promise.all([
        fetchOhlcvForTickers(US_ETF_TICKERS, winDays, recoverCfg),
        fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, recoverCfg)
      ]);
      usData = usRes.byTicker;
      jpData = jpRes.byTicker;
      for (const [ticker, err] of Object.entries({ ...usRes.errors, ...jpRes.errors })) {
        logger.warn(`Signal data (recovery) ${ticker}: ${err}`);
      }
      ({ retUs, retJp, dates } = buildReturnMatricesFromOhlcv(
        usData,
        jpData,
        US_ETF_TICKERS,
        JP_ETF_TICKERS,
        config.backtest.jpWindowReturn
      ));
    }

    if (retUs.length < signalConfig.windowLength) {
      const usErrN = Object.keys(usRes.errors || {}).length;
      const jpErrN = Object.keys(jpRes.errors || {}).length;
      const usProv = String(config.data.usOhlcvProvider || '').toLowerCase();
      const retrySuffix = signalDataRecoveryAttempted
        ? ' サーバー側で Yahoo 経路への自動切替・再取得を試みましたが、まだ不足しています。'
        : '';
      const avHint =
        !signalDataRecoveryAttempted && usProv === 'alphavantage'
          ? ' 米国が Alpha Vantage（無料 compact は約100営業日）のときは窓が大きいと不足しやすいです。画面のデータソースで米国を Yahoo にするか、ウィンドウ長を下げてください。'
          : '';
      return res.json({
        error: 'データが不足しています',
        detail:
          `揃った営業日が ${retUs.length} 日（要 ${signalConfig.windowLength} 日以上）。` +
          `取得窓は約 ${winDays} カレンダー日。米国/日本でエラー記録のある銘柄: ${usErrN} / ${jpErrN}。` +
          ' API 制限・休場・一部銘柄欠損で行が捨てられている可能性があります。' +
          retrySuffix +
          avHint,
        signals: [],
        sourceSummary: summarizeSignalSourcePaths(usRes.sources, jpRes.sources),
        opsDecision: buildOpsDecision({
          usSources: usRes.sources,
          jpSources: jpRes.sources,
          usErrors: usRes.errors,
          jpErrors: jpRes.errors,
          signalDataRecoveryAttempted,
          insufficientData: true
        }),
        disclosure: riskPayload()
      });
    }

    // C_full 計算
    const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
    const CFull = correlationMatrixSample(combined);

    // シグナル計算
    const signalGen = new LeadLagSignal(signalConfig);
    const retUsWin = retUs.slice(-signalConfig.windowLength).map(r => r.values);
    const retJpWin = retJp.slice(-signalConfig.windowLength).map(r => r.values);
    const retUsLatest = retUs[retUs.length - 1].values;

    const signal = signalGen.computeSignal(
      retUsWin,
      retJpWin,
      retUsLatest,
      config.sectorLabels,
      CFull
    );

    // ランキング作成
    const signals = JP_ETF_TICKERS.map((ticker, i) => ({
      ticker,
      name: JP_ETF_NAMES[ticker] || ticker,
      signal: signal[i],
      rank: 0
    })).sort((a, b) => b.signal - a.signal);

    signals.forEach((s, i) => s.rank = i + 1);

    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();
    const quoteResults = await Promise.all(
      JP_ETF_TICKERS.map(async (ticker) => {
        try {
          const quote = await fetchWithRetry(
            () => yahooFinance.quote(ticker),
            { maxRetries: 2, baseDelay: 500 }
          );
          return [ticker, quote.regularMarketPrice || 0];
        } catch {
          return [ticker, 0];
        }
      })
    );
    const prices = Object.fromEntries(quoteResults);

    signals.forEach(s => {
      s.price = prices[s.ticker] || 0;
      s.priceFormatted = s.price > 0 ? `${s.price.toLocaleString()}円/口` : 'N/A';
    });

    // 買い/売り候補
    const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * signalConfig.quantile));
    const buyCandidates = signals.slice(0, buyCount);
    const sellCandidates = signals.slice(-buyCount);

    const meanSig = signal.reduce((a, b) => a + b, 0) / signal.length;
    const stdSig = Math.sqrt(
      signal.reduce((sq, x) => sq + Math.pow(x - meanSig, 2), 0) / signal.length
    );

    res.json({
      config: signalConfig,
      signals,
      buyCandidates,
      sellCandidates,
      latestDate: dates[dates.length - 1],
      metrics: {
        meanSignal: meanSig,
        stdSignal: stdSig
      },
      sourceSummary: summarizeSignalSourcePaths(usRes.sources, jpRes.sources),
      opsDecision: buildOpsDecision({
        usSources: usRes.sources,
        jpSources: jpRes.sources,
        usErrors: usRes.errors,
        jpErrors: jpRes.errors,
        signalDataRecoveryAttempted,
        insufficientData: false
      }),
      ...(signalDataRecoveryAttempted
        ? {
          dataRecoveryNote:
              '初回の取得では営業日が足りなかったため、自動で Yahoo 経路に切り替えて再取得し、このシグナルを表示しています。'
        }
        : {}),
      disclosure: riskPayload()
    });

  } catch (error) {
    logger.error('Signal generation failed', {
      error: error.message,
      path: '/api/signal'
    });
    res.status(500).json({
      error: config.server.isDevelopment ? error.message : 'Signal generation failed'
    });
  }
});

/**
 * 設定取得 API
 */
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    dataMode: config.data.mode,
    usOhlcvProvider: config.data.usOhlcvProvider,
    disclosure: riskPayload(),
    dataSources: getDataSourcesForUi()
  });
});

/**
 * 設定更新 API
 */
app.post('/api/config', (req, res) => {
  const { windowLength, lambdaReg, quantile } = req.body;
  const dataMode = req.body.dataMode ?? req.body.mode;
  const usOhlcvProvider = req.body.usOhlcvProvider ?? req.body.us_ohlcv_provider;
  const errors = [];

  errors.push(
    ...getDataSourceUpdateErrors({
      mode: dataMode,
      usOhlcvProvider
    })
  );

  let nextWindowLength = config.backtest.windowLength;
  let nextLambdaReg = config.backtest.lambdaReg;
  let nextQuantile = config.backtest.quantile;

  if (windowLength !== undefined) {
    const val = parseInt(windowLength, 10);
    if (isNaN(val) || val < 10 || val > 500) {
      errors.push('windowLength must be between 10 and 500');
    } else {
      nextWindowLength = val;
    }
  }

  if (lambdaReg !== undefined) {
    const val = parseFloat(lambdaReg);
    if (isNaN(val) || val < 0 || val > 1) {
      errors.push('lambdaReg must be between 0 and 1');
    } else {
      nextLambdaReg = val;
    }
  }

  if (quantile !== undefined) {
    const val = parseFloat(quantile);
    if (isNaN(val) || val <= 0 || val > 0.5) {
      errors.push('quantile must be between 0 and 0.5');
    } else {
      nextQuantile = val;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Invalid parameters', details: errors });
  }

  applyDataSourceSettings({
    mode: dataMode,
    usOhlcvProvider
  });
  config.backtest.windowLength = nextWindowLength;
  config.backtest.lambdaReg = nextLambdaReg;
  config.backtest.quantile = nextQuantile;

  logger.info('Configuration updated via API', {
    windowLength: config.backtest.windowLength,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    dataMode: config.data.mode,
    usOhlcvProvider: config.data.usOhlcvProvider
  });

  res.json({
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    dataMode: config.data.mode,
    usOhlcvProvider: config.data.usOhlcvProvider,
    disclosure: riskPayload(),
    dataSources: getDataSourcesForUi()
  });
});

app.get('/api/ops/summary', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const latest = runtimeState.lastSignal || null;
  const anomalyCount = runtimeState.anomalies.length;
  const quality = runtimeState.lastDataQuality || null;
  res.json({
    latestSignalAt: latest ? latest.at : null,
    anomalyCount,
    dataQuality: quality
      ? {
        ok: quality.ok,
        badTickers: quality.badTickers
      }
      : null
  });
});

app.get('/api/alerts', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
  const p = path.join(path.resolve(config.data.outputDir), 'notifications.log');
  if (!fs.existsSync(p)) {
    return res.json({ alerts: [] });
  }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-200);
  const alerts = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
  res.json({ alerts });
});

app.get('/api/audit', ensureRole(['admin']), (_req, res) => {
  const p = path.join(path.resolve(config.data.outputDir), 'audit.log');
  if (!fs.existsSync(p)) {
    return res.json({ entries: [] });
  }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-500);
  const entries = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
  res.json({ entries });
});

app.get('/api/presets', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
  res.json({
    active: config.preset.active,
    presets: config.preset.profiles
  });
});

app.post('/api/presets/apply', ensureRole(['trader', 'admin']), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const p = config.preset.profiles[name];
  if (!p) {
    return res.status(400).json({ error: 'Unknown preset', available: Object.keys(config.preset.profiles) });
  }
  config.backtest.windowLength = p.windowLength;
  config.backtest.lambdaReg = p.lambdaReg;
  config.backtest.quantile = p.quantile;
  config.backtest.stability.maxPositionAbs = p.maxPositionAbs;
  config.backtest.stability.maxGrossExposure = p.maxGrossExposure;
  config.backtest.stability.dailyLossStop = p.dailyLossStop;
  config.preset.active = name;
  writeAudit('preset.apply', { actorRole: req.role, name });
  res.json({ ok: true, active: name, applied: p });
});

app.get('/api/anomalies', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
  res.json({ items: runtimeState.anomalies.slice(-500) });
});

app.post('/api/allocation/optimize', ensureRole(['trader', 'admin']), (req, res) => {
  const metricsByStrategy = req.body?.metricsByStrategy || {};
  const allocation = inverseVolAllocation(metricsByStrategy);
  writeAudit('allocation.optimize', {
    actorRole: req.role,
    strategyCount: Object.keys(metricsByStrategy).length
  });
  res.json({ allocation });
});

app.post('/api/execution/plan', ensureRole(['trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  const plan = buildExecutionPlan(signals, {
    cash: Number(req.body?.cash || config.trading.initialCapital),
    lotSize: Number(req.body?.lotSize || 1),
    maxPerOrder: Number(req.body?.maxPerOrder || config.trading.initialCapital),
    minOrderValue: Number(req.body?.minOrderValue || 0)
  });
  writeAudit('execution.plan', {
    actorRole: req.role,
    orderCount: plan.totalOrders,
    totalValue: plan.totalValue
  });
  res.json(plan);
});

app.post('/api/explain', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  res.json(explainSignals(signals, Number(req.body?.topN || 5)));
});

/**
 * 免責・リスク説明（Web / クライアント用）
 */
app.get('/api/disclosure', (req, res) => {
  res.json(riskPayload());
});

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
    return res.status(400).json({ error: 'Unknown preset', available: Object.keys(config.operations.profiles || {}) });
  }
  config.backtest.windowLength = Number(preset.windowLength);
  config.backtest.lambdaReg = Number(preset.lambdaReg);
  config.backtest.quantile = Number(preset.quantile);
  config.backtest.stability.maxPositionAbs = Number(preset.maxPositionAbs);
  config.backtest.stability.maxGrossExposure = Number(preset.maxGrossExposure);
  config.backtest.stability.dailyLossStop = Number(preset.dailyLossStop);
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

app.get('/api/audit', ensureRole(['admin']), (req, res) => {
  const p = AUDIT_PATH;
  if (!require('fs').existsSync(p)) {
    return res.json({ entries: [] });
  }
  const text = require('fs').readFileSync(p, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const entries = lines.slice(-200).map((line) => {
    try { return JSON.parse(line); } catch { return { malformed: true, line }; }
  });
  res.json({ entries });
});

app.get('/api/alerts', ensureRole(['viewer', 'trader', 'admin']), (_req, res) => {
  const p = require('path').resolve(config.data.outputDir, 'notifications.log');
  if (!require('fs').existsSync(p)) {
    return res.json({ alerts: [] });
  }
  const text = require('fs').readFileSync(p, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const alerts = lines.slice(-200).map((line) => {
    try { return JSON.parse(line); } catch { return { malformed: true, line }; }
  });
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

app.post('/api/allocation', ensureRole(['trader', 'admin']), (req, res) => {
  const metricsByStrategy = req.body?.metricsByStrategy || {};
  const weights = inverseVolAllocation(metricsByStrategy);
  writeAudit('allocation.inverse_vol', { role: req.role, strategies: Object.keys(metricsByStrategy).length });
  res.json({ weights });
});

app.post('/api/explain', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  res.json(explainSignals(signals, Number(req.body?.topN || 5)));
});

app.get('/api/monitoring', ensureRole(['viewer', 'trader', 'admin']), async (_req, res) => {
  const days = Number(config.operations.dataQuality.lookbackDays || 180);
  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, days, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, days, config)
  ]);
  const dqUs = assessDataQuality(usRes.byTicker);
  const dqJp = assessDataQuality(jpRes.byTicker);
  res.json({
    dataQuality: {
      us: dqUs,
      jp: dqJp
    },
    strictMode: Boolean(config.ops.strictDataSource),
    activePreset: config.operations.activePreset
  });
});

/**
 * 運用プリセット一覧
 */
app.get('/api/presets', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const presetNames = Object.keys(config.preset.profiles || {});
  res.json({ active: config.preset.active, presets: presetNames });
});

/**
 * 運用プリセット適用
 */
app.post('/api/presets/apply', ensureRole(['trader', 'admin']), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const profiles = config.preset.profiles || {};
  if (!name || !Object.prototype.hasOwnProperty.call(profiles, name)) {
    return res.status(400).json({ error: 'Unknown preset', available: Object.keys(profiles) });
  }
  const p = profiles[name];
  const prev = {
    windowLength: config.backtest.windowLength,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile
  };
  config.backtest.windowLength = Number(p.windowLength);
  config.backtest.lambdaReg = Number(p.lambdaReg);
  config.backtest.quantile = Number(p.quantile);
  config.backtest.stability.maxPositionAbs = Number(p.maxPositionAbs);
  config.backtest.stability.maxGrossExposure = Number(p.maxGrossExposure);
  config.backtest.stability.dailyLossStop = Number(p.dailyLossStop);
  config.preset.active = name;
  writeAudit('preset_applied', {
    actor: req.headers['x-user-id'] || 'unknown',
    role: req.role,
    previous: prev,
    next: {
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile
    },
    name
  });
  res.json({
    ok: true,
    active: name,
    backtest: {
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile
    }
  });
});

/**
 * 通知送信テスト
 */
app.post('/api/notifications/test', ensureRole(['admin']), async (req, res) => {
  const msg = String(req.body?.message || 'manual test notification');
  const result = await sendNotification({
    channel: config.ops.notificationChannel,
    message: msg,
    level: 'warn',
    context: { by: req.headers['x-user-id'] || 'unknown' },
    config
  });
  writeAudit('notification_test', {
    actor: req.headers['x-user-id'] || 'unknown',
    role: req.role,
    result
  });
  res.json({ ok: true, result });
});

/**
 * 監査ログ取得
 */
app.get('/api/audit', ensureRole(['admin']), (req, res) => {
  const limitRaw = parseInt(String(req.query.limit || '100'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
  const p = AUDIT_PATH;
  if (!require('fs').existsSync(p)) return res.json({ entries: [] });
  const lines = require('fs').readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-limit);
  const entries = lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  res.json({ entries });
});

/**
 * データ品質レポート（直近取得データ）
 */
app.post('/api/data-quality/check', ensureRole(['viewer', 'trader', 'admin']), async (req, res) => {
  const days = Math.max(30, Number(req.body?.days || 120));
  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, days, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, days, config)
  ]);
  const reportUs = assessDataQuality(usRes.byTicker);
  const reportJp = assessDataQuality(jpRes.byTicker);
  const ok = reportUs.ok && reportJp.ok;
  if (!ok) {
    await sendNotification({
      channel: config.ops.notificationChannel,
      level: 'warn',
      message: 'Data quality warning',
      context: {
        usBad: reportUs.badTickers,
        jpBad: reportJp.badTickers
      },
      config
    });
  }
  res.json({ ok, us: reportUs, jp: reportJp });
});

/**
 * 執行プラン生成（シグナル→注文）
 */
app.post('/api/execution/plan', ensureRole(['trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  const plan = buildExecutionPlan(signals, {
    cash: Number(req.body?.cash || config.trading.initialCapital),
    lotSize: Number(req.body?.lotSize || 1),
    maxPerOrder: Number(req.body?.maxPerOrder || config.trading.initialCapital * 0.2),
    minOrderValue: Number(req.body?.minOrderValue || 1000)
  });
  writeAudit('execution_plan', {
    actor: req.headers['x-user-id'] || 'unknown',
    role: req.role,
    totalOrders: plan.totalOrders,
    totalValue: plan.totalValue
  });
  res.json(plan);
});

/**
 * 複数戦略配分（逆ボラ）
 */
app.post('/api/allocation', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const metrics = req.body?.metricsByStrategy || {};
  const weights = inverseVolAllocation(metrics);
  res.json({ weights });
});

/**
 * シグナル説明（寄与）
 */
app.post('/api/explain', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  const topN = Math.max(1, Math.min(20, Number(req.body?.topN || 5)));
  res.json(explainSignals(signals, topN));
});

/**
 * 運用プリセット一覧
 */
app.get('/api/presets', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const presets = Object.entries(config.operations?.profiles || {}).map(([name, p]) => ({
    name,
    windowLength: p.windowLength,
    lambdaReg: p.lambdaReg,
    quantile: p.quantile
  }));
  res.json({ active: config.preset?.active || null, presets });
});

/**
 * 運用プリセット適用
 */
app.post('/api/presets/apply', ensureRole(['trader', 'admin']), (req, res) => {
  const name = String(req.body?.name || '').trim().toLowerCase();
  const profile = config.operations?.profiles?.[name];
  if (!profile) {
    return res.status(400).json({
      error: 'Unknown preset',
      available: Object.keys(config.operations?.profiles || {})
    });
  }
  config.backtest.windowLength = Number(profile.windowLength);
  config.backtest.lambdaReg = Number(profile.lambdaReg);
  config.backtest.quantile = Number(profile.quantile);
  config.backtest.stability.maxPositionAbs = Number(profile.maxPositionAbs);
  config.backtest.stability.maxGrossExposure = Number(profile.maxGrossExposure);
  config.backtest.stability.dailyLossStop = Number(profile.dailyLossStop);
  if (config.preset) config.preset.active = name;
  writeAudit('preset.apply', {
    actor: req.userRole,
    preset: name,
    path: req.path
  });
  res.json({
    ok: true,
    active: name,
    applied: profile
  });
});

/**
 * 監査ログ取得
 */
app.get('/api/audit', ensureRole(['admin']), (req, res) => {
  const limitRaw = parseInt(String(req.query.limit || '100'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
  res.json({ path: AUDIT_PATH, entries: readAuditEntries(limit) });
});

/**
 * 通知履歴（簡易）
 */
app.get('/api/alerts', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const logPath = path.join(path.resolve(config.data.outputDir), 'notifications.log');
  if (!fs.existsSync(logPath)) return res.json({ alerts: [] });
  const rows = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-200)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  res.json({ alerts: rows });
});

/**
 * データ品質チェック
 */
app.get('/api/ops/data-quality', ensureRole(['trader', 'admin']), async (req, res) => {
  const daysRaw = parseInt(String(req.query.days || config.operations.dataQuality.lookbackDays), 10);
  const days = Number.isFinite(daysRaw) ? Math.max(30, Math.min(3000, daysRaw)) : config.operations.dataQuality.lookbackDays;
  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, days, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, days, config)
  ]);
  const quality = assessDataQuality({ ...usRes.byTicker, ...jpRes.byTicker });
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

/**
 * 執行プラン（シグナル→注文）
 */
app.post('/api/execution/plan', ensureRole(['trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  const cash = Number(req.body?.cash ?? config.trading.initialCapital);
  const plan = buildExecutionPlan(signals, {
    cash,
    lotSize: req.body?.lotSize ?? 1,
    maxPerOrder: req.body?.maxPerOrder ?? cash,
    minOrderValue: req.body?.minOrderValue ?? 0
  });
  writeAudit('execution.plan', {
    actor: req.userRole,
    path: req.path,
    orders: plan.totalOrders
  });
  res.json(plan);
});

/**
 * 戦略配分（逆ボラ）
 */
app.post('/api/allocation/optimize', ensureRole(['trader', 'admin']), (req, res) => {
  const metricsByStrategy = req.body?.metricsByStrategy || {};
  const weights = inverseVolAllocation(metricsByStrategy);
  writeAudit('allocation.optimize', {
    actor: req.userRole,
    strategies: Object.keys(metricsByStrategy).length
  });
  res.json({ weights });
});

/**
 * 説明性
 */
app.post('/api/explain', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
  res.json(explainSignals(signals, req.body?.topN ?? 5));
});

/**
 * 監視サマリ
 */
app.get('/api/monitoring', ensureRole(['viewer', 'trader', 'admin']), (req, res) => {
  res.json({
    strictDataSource: config.operations.strictDataSource,
    notificationChannel: config.operations.notificationChannel,
    auditPath: AUDIT_PATH
  });
});

/**
 * ヘルスチェック
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// エラーハンドリング（全ルートの後）
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, _next) => {
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
