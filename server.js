/**
 * 日米業種リードラグ戦略 - Web バックテストサーバー
 * 銘柄選択シグナルをリアルタイムで生成
 */

'use strict';

const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// ライブラリ
const { createLogger } = require('./lib/logger');
const { config, validate } = require('./lib/config');
const {
  SubspaceRegularizedPCA,
  LeadLagSignal
} = require('./lib/pca');
const {
  buildPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('./lib/portfolio');
const {
  correlationMatrixSample
} = require('./lib/math');
const {
  fetchWithRetry,
  loadCSV,
  buildPaperAlignedReturnRows
} = require('./lib/data');

const logger = createLogger('Server');

const app = express();

// ============================================
// セキュリティ設定
// ============================================

// レート制限：API エンドポイントごと
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分
  max: 30, // 1 分あたり最大 30 リクエスト
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

//  stricter rate limit for backtest endpoint
const backtestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 分
  max: 10, // 5 分あたり最大 10 リクエスト
  message: { error: 'Backtest requests are rate-limited to 10 per 5 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// ミドルウェア
// ============================================

app.use(cors());
app.use(express.json({ limit: '1mb' })); // リクエストサイズ制限
app.use(express.static('public'));

// API エンドポイントにレート制限を適用
app.use('/api/', apiLimiter);
app.use('/api/backtest', backtestLimiter);

// ============================================
// エラーハンドリング
// ============================================

// 404 エラー
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// 汎用エラーハンドラー（機密情報を除外）
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

// 設定の検証
const configErrors = validate();
if (configErrors.length > 0) {
  logger.warn('Configuration warnings', { warnings: configErrors });
}

// ============================================
// 定数
// ============================================

const JP_ETF_TICKERS = [
  '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
  '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
  '1631.T', '1632.T', '1633.T'
];

const JP_ETF_NAMES = {
  '1617.T': '食品', '1618.T': 'エネルギー資源', '1619.T': '建設・資材',
  '1620.T': '素材・化学', '1621.T': '医薬品', '1622.T': '自動車・輸送機',
  '1623.T': '鉄鋼・非鉄', '1624.T': '機械', '1625.T': '電機・精密',
  '1626.T': '情報通信', '1627.T': '電力・ガス', '1628.T': '運輸・物流',
  '1629.T': '商社・卸売', '1630.T': '小売', '1631.T': '銀行',
  '1632.T': '証券・商品', '1633.T': '保険'
};

const US_ETF_TICKERS = [
  'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'
];

// ============================================
// 入力検証ヘルパー
// ============================================

/**
 * リクエストパラメータを検証・サニタイズ
 */
function validateBacktestParams(body) {
  const errors = [];
  const params = {};

  // windowLength
  if (body.windowLength !== undefined) {
    const val = parseInt(body.windowLength, 10);
    if (isNaN(val) || val < 10 || val > 500) {
      errors.push('windowLength must be between 10 and 500');
    } else {
      params.windowLength = val;
    }
  }

  // lambdaReg
  if (body.lambdaReg !== undefined) {
    const val = parseFloat(body.lambdaReg);
    if (isNaN(val) || val < 0 || val > 1) {
      errors.push('lambdaReg must be between 0 and 1');
    } else {
      params.lambdaReg = val;
    }
  }

  // quantile
  if (body.quantile !== undefined) {
    const val = parseFloat(body.quantile);
    if (isNaN(val) || val <= 0 || val > 0.5) {
      errors.push('quantile must be between 0 and 0.5');
    } else {
      params.quantile = val;
    }
  }

  // nFactors
  if (body.nFactors !== undefined) {
    const val = parseInt(body.nFactors, 10);
    if (isNaN(val) || val < 1 || val > 10) {
      errors.push('nFactors must be between 1 and 10');
    } else {
      params.nFactors = val;
    }
  }

  return { errors, params };
}

/**
 * 数値パラメータを安全に解析（デフォルト値付き）
 */
function parseLambdaReg(value, defaultVal) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : defaultVal;
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
// データ取得
// ============================================

/**
 * Yahoo Finance からデータを取得（リトライ付き）
 * @param {string} ticker - ティッカー
 * @param {number} days - 取得日数
 * @returns {Promise<{data: Array, error: string|null}>}
 */
async function fetchData(ticker, days = 200) {
  if (config.data.mode === 'csv') {
    const filePath = path.join(path.resolve(config.data.dataDir), `${ticker}.csv`);
    if (!fs.existsSync(filePath)) {
      return { data: [], error: `CSV not found: ${filePath}` };
    }
    try {
      const rows = loadCSV(filePath).map(row => ({
        date: String(row.Date || row.date || '').split('T')[0],
        open: Number(row.Open ?? row.open),
        high: Number(row.High ?? row.high),
        low: Number(row.Low ?? row.low),
        close: Number(row.Close ?? row.close),
        volume: Number(row.Volume ?? row.volume ?? 0)
      })).filter(r => r.date && Number.isFinite(r.close) && r.close > 0);

      const data = days > 0 && rows.length > days ? rows.slice(-days) : rows;
      return { data, error: null };
    } catch (error) {
      return { data: [], error: error.message };
    }
  }

  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await fetchWithRetry(
      () => yahooFinance.chart(ticker, {
        period1: startDate.toISOString().split('T')[0],
        period2: endDate.toISOString().split('T')[0],
        interval: '1d'
      }),
      { maxRetries: 3, baseDelay: 1000 }
    );

    const data = result.quotes
      .filter(q => q.close !== null && q.close > 0)
      .map(q => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume
      }));

    return { data, error: null };
  } catch (error) {
    logger.warn(`Failed to fetch data for ${ticker}`, { error: error.message });
    return { data: [], error: error.message };
  }
}

/**
 * リターンを計算
 */
function computeReturns(ohlc, type = 'cc') {
  if (!ohlc || ohlc.length < 2) return [];

  if (type === 'cc') {
    const returns = [];
    let prev = null;
    for (const r of ohlc) {
      if (prev !== null) {
        returns.push((r.close - prev) / prev);
      }
      prev = r.close;
    }
    return returns;
  } else {
    return ohlc
      .filter(r => r.open > 0)
      .map(r => (r.close - r.open) / r.open);
  }
}

/**
 * リターンマトリックスを構築（日付アライメント改善版）
 */
function buildReturnMatrices(usData, jpData) {
  const usCC = {};
  const jpCC = {};
  const jpOC = {};

  for (const t of US_ETF_TICKERS) {
    usCC[t] = computeReturns(usData[t], 'cc');
  }
  for (const t of JP_ETF_TICKERS) {
    jpCC[t] = computeReturns(jpData[t], 'cc');
    jpOC[t] = computeReturns(jpData[t], 'oc');
  }

  // 日付マップ
  const usMap = new Map();
  const jpCCMap = new Map();
  const jpOCMap = new Map();

  for (const t of US_ETF_TICKERS) {
    const data = usData[t];
    for (let i = 1; i < data.length; i++) {
      const ret = (data[i].close - data[i - 1].close) / data[i - 1].close;
      if (!usMap.has(data[i].date)) usMap.set(data[i].date, {});
      usMap.get(data[i].date)[t] = ret;
    }
  }

  for (const t of JP_ETF_TICKERS) {
    const data = jpData[t];
    for (let i = 1; i < data.length; i++) {
      const ccRet = (data[i].close - data[i - 1].close) / data[i - 1].close;
      const ocRet = (data[i].close - data[i].open) / data[i].open;
      if (!jpCCMap.has(data[i].date)) jpCCMap.set(data[i].date, {});
      jpCCMap.get(data[i].date)[t] = ccRet;
      if (!jpOCMap.has(data[i].date)) jpOCMap.set(data[i].date, {});
      jpOCMap.get(data[i].date)[t] = ocRet;
    }
  }

  return buildPaperAlignedReturnRows(
    usMap,
    jpCCMap,
    jpOCMap,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );
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

    const backtestConfig = {
      windowLength: validation.params.windowLength || config.backtest.windowLength,
      nFactors: validation.params.nFactors || config.backtest.nFactors,
      lambdaReg: validation.params.lambdaReg !== undefined
        ? validation.params.lambdaReg
        : config.backtest.lambdaReg,
      quantile: validation.params.quantile || config.backtest.quantile,
      warmupPeriod: validation.params.windowLength || config.backtest.warmupPeriod,
      orderedSectorKeys: config.pca.orderedSectorKeys
    };

    const costs = config.backtest.transactionCosts;
    const chartDays = config.backtest.chartCalendarDays;

    logger.info('Running backtest', {
      ...backtestConfig,
      chartCalendarDays: chartDays,
      costs
    });

    // データ取得
    logger.info('Fetching US ETF data');
    const usData = {};
    for (const ticker of US_ETF_TICKERS) {
      const usResult = await fetchData(ticker, chartDays);
      if (usResult.error) {
        logger.warn(`Failed to fetch US data for ${ticker}: ${usResult.error}`);
      }
      usData[ticker] = usResult.data;
    }

    logger.info('Fetching JP ETF data');
    const jpData = {};
    for (const ticker of JP_ETF_TICKERS) {
      const jpResult = await fetchData(ticker, chartDays);
      if (jpResult.error) {
        logger.warn(`Failed to fetch JP data for ${ticker}: ${jpResult.error}`);
      }
      jpData[ticker] = jpResult.data;
    }

    const { retUs, retJp, retJpOc, dates } = buildReturnMatrices(usData, jpData);

    logger.info(`Data loaded: ${dates.length} trading days`);

    // データ量チェック
    if (dates.length < backtestConfig.warmupPeriod + 10) {
      return res.json({
        error: 'データが不足しています',
        metrics: { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0, Days: dates.length }
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

    // バックテストループ（参照のみ使用：不要なコピーを削除）
    for (let i = backtestConfig.warmupPeriod; i < retJpOc.length; i++) {
      const start = i - backtestConfig.windowLength;
      const retUsWin = retUs.slice(start, i).map(r => r.values);
      const retJpWin = retJp.slice(start, i).map(r => r.values);
      const retUsLatest = retUs[i - 1].values;

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
      stratRet = applyTransactionCosts(stratRet, costs);

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
      momRet = applyTransactionCosts(momRet, costs);
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
      costsNote:
        'PCA 戦略・モメンタム LS は backtest_real と同様の applyTransactionCosts（往復相当でコスト×2）。' +
        'JP 業種均等ロングはコストなしの単純平均 OC リターン（比較用ベンチマーク）。',
      results: results.slice(-200),
      metrics: {
        ...toDisplayMetrics(mStrat, stratDays),
        costsApplied: true,
        equalWeightJP: toDisplayMetrics(mEq, equalWeightSeries.length),
        momentum: toDisplayMetrics(mMom, momentumSeries.length)
      },
      yearlyStrategy,
      rollingSummary
    });

  } catch (error) {
    logger.error('Backtest failed', {
      error: error.message,
      path: '/api/backtest'
    });
    res.status(500).json({
      error: config.server.isDevelopment ? error.message : 'Backtest failed'
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

    // データ取得
    const usData = {};
    const jpData = {};

    for (const ticker of US_ETF_TICKERS) {
      const usResult = await fetchData(ticker, signalConfig.windowLength + 50);
      if (usResult.error) {
        logger.warn(`Failed to fetch US data for ${ticker}: ${usResult.error}`);
      }
      usData[ticker] = usResult.data;
    }
    for (const ticker of JP_ETF_TICKERS) {
      const jpResult = await fetchData(ticker, signalConfig.windowLength + 50);
      if (jpResult.error) {
        logger.warn(`Failed to fetch JP data for ${ticker}: ${jpResult.error}`);
      }
      jpData[ticker] = jpResult.data;
    }

    const { retUs, retJp, dates } = buildReturnMatrices(usData, jpData);

    if (retUs.length < signalConfig.windowLength) {
      return res.json({ error: 'データが不足しています', signals: [] });
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

    // 価格取得
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();
    const prices = {};

    for (const ticker of JP_ETF_TICKERS) {
      try {
        const quote = await fetchWithRetry(
          () => yahooFinance.quote(ticker),
          { maxRetries: 2, baseDelay: 500 }
        );
        prices[ticker] = quote.regularMarketPrice || 0;
      } catch (e) {
        prices[ticker] = 0;
      }
    }

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
      }
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
  res.json({
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile
  });
});

/**
 * 設定更新 API
 */
app.post('/api/config', (req, res) => {
  const { windowLength, lambdaReg, quantile } = req.body;

  if (windowLength !== undefined) config.backtest.windowLength = windowLength;
  if (lambdaReg !== undefined) config.backtest.lambdaReg = lambdaReg;
  if (quantile !== undefined) config.backtest.quantile = quantile;

  res.json({
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile
  });
});

/**
 * ヘルスチェック
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// サーバー起動
// ============================================

const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`Server started`, { port: PORT, env: config.server.env });
  logger.info('API endpoints:', {
    'POST /api/backtest': 'Run backtest',
    'POST /api/signal': 'Generate signal',
    'GET /api/config': 'Get configuration',
    'POST /api/config': 'Update configuration',
    'GET /api/health': 'Health check'
  });
});
