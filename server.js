/**
 * 日米業種リードラグ戦略 - Web バックテストサーバー
 * 銘柄選択シグナルをリアルタイムで生成
 */

'use strict';

const express = require('express');
const cors = require('cors');
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
  computePerformanceMetrics 
} = require('./lib/portfolio');
const { 
  correlationMatrix 
} = require('./lib/math');

const logger = createLogger('Server');

const app = express();

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// エラー処理 middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// 設定の検証
const configErrors = validate();
if (configErrors.length > 0) {
  logger.warn('Configuration warnings', { warnings: configErrors });
}

// 日本セクター ETF
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

// 米国セクター ETF
const US_ETF_TICKERS = [
  'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'
];

/**
 * Yahoo Financeからデータを取得
 * @param {string} ticker - ティッカー
 * @param {number} days - 取得日数
 * @returns {Promise<Array>} OHLCVデータ
 */
async function fetchData(ticker, days = 200) {
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await yahooFinance.chart(ticker, {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d'
    });

    return result.quotes
      .filter(q => q.close !== null && q.close > 0)
      .map(q => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume
      }));
  } catch (error) {
    logger.error(`Failed to fetch data for ${ticker}`, { error: error.message });
    return [];
  }
}

/**
 * リターンを計算
 * @param {Array} ohlc - OHLCVデータ
 * @param {string} type - 'cc' (close-to-close) or 'oc' (open-to-close)
 * @returns {Array} リターン配列
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
 * リターンマトリックスを構築
 */
function buildReturnMatrices(usData, jpData) {
  // CC Returns
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

  // Date maps
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

  // Common dates
  const usDates = new Set([...usMap.keys()].sort());
  const jpDates = new Set([...jpCCMap.keys()].sort());
  const commonDates = [...usDates].filter(d => jpDates.has(d)).sort();

  // Build matrices
  const retUs = [];
  const retJp = [];
  const retJpOc = [];
  const dates = [];

  for (let i = 1; i < commonDates.length; i++) {
    const usDate = commonDates[i - 1];
    const jpDate = commonDates[i];

    const usRow = US_ETF_TICKERS.map(t => usMap.get(usDate)?.[t]);
    const jpRow = JP_ETF_TICKERS.map(t => jpCCMap.get(jpDate)?.[t]);
    const jpOcRow = JP_ETF_TICKERS.map(t => jpOCMap.get(jpDate)?.[t]);

    if (usRow.some(v => v === undefined) || 
        jpRow.some(v => v === undefined) || 
        jpOcRow.some(v => v === undefined)) {
      continue;
    }

    retUs.push({ date: usDate, values: usRow });
    retJp.push({ date: jpDate, values: jpRow });
    retJpOc.push({ date: jpDate, values: jpOcRow });
    dates.push(jpDate);
  }

  return { retUs, retJp, retJpOc, dates };
}

// ============================================
// API Endpoints
// ============================================

/**
 * バックテスト API
 */
app.post('/api/backtest', async (req, res) => {
  try {
    const { windowLength, lambdaReg, quantile } = req.body;

    const backtestConfig = {
      windowLength: parseInt(windowLength) || config.backtest.windowLength,
      nFactors: config.backtest.nFactors,
      lambdaReg: parseFloat(lambdaReg) ?? config.backtest.lambdaReg,
      quantile: parseFloat(quantile) || config.backtest.quantile,
      warmupPeriod: parseInt(windowLength) || config.backtest.warmupPeriod
    };

    logger.info('Running backtest', backtestConfig);

    // Fetch data
    logger.info('Fetching US ETF data');
    const usData = {};
    for (const ticker of US_ETF_TICKERS) {
      usData[ticker] = await fetchData(ticker, 500);
    }

    logger.info('Fetching JP ETF data');
    const jpData = {};
    for (const ticker of JP_ETF_TICKERS) {
      jpData[ticker] = await fetchData(ticker, 500);
    }

    const { retUs, retJp, retJpOc, dates } = buildReturnMatrices(usData, jpData);

    logger.info(`Data loaded: ${dates.length} trading days`);

    if (dates.length < backtestConfig.warmupPeriod + 10) {
      return res.json({
        error: 'データが不足しています',
        metrics: { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0, Days: dates.length }
      });
    }

    // Compute C_full
    const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
      .map((r, i) => [...r.values, ...retJp[i].values]);
    const CFull = correlationMatrix(combined);

    // Run backtest
    const signalGen = new LeadLagSignal(backtestConfig);
    const results = [];

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

      let stratRet = 0;
      for (let j = 0; j < weights.length; j++) {
        stratRet += weights[j] * retNext[j];
      }

      results.push({
        date: retJpOc[i].date,
        return: stratRet
      });
    }

    // Compute metrics
    const returns = results.map(r => r.return);
    const metrics = computePerformanceMetrics(returns);

    res.json({
      config: backtestConfig,
      results: results.slice(-200),
      metrics: {
        AR: metrics.AR * 100,
        RISK: metrics.RISK * 100,
        RR: metrics.RR,
        MDD: metrics.MDD * 100,
        Total: (metrics.Cumulative - 1) * 100,
        Days: returns.length
      }
    });

  } catch (error) {
    logger.error('Backtest failed', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

/**
 * シグナル生成 API
 */
app.post('/api/signal', async (req, res) => {
  try {
    const { windowLength, lambdaReg, quantile } = req.body;

    const signalConfig = {
      windowLength: parseInt(windowLength) || config.backtest.windowLength,
      nFactors: config.backtest.nFactors,
      lambdaReg: parseFloat(lambdaReg) ?? config.backtest.lambdaReg,
      quantile: parseFloat(quantile) || config.backtest.quantile
    };

    logger.info('Generating signal', signalConfig);

    // Fetch data
    const usData = {};
    const jpData = {};

    for (const ticker of US_ETF_TICKERS) {
      usData[ticker] = await fetchData(ticker, signalConfig.windowLength + 50);
    }
    for (const ticker of JP_ETF_TICKERS) {
      jpData[ticker] = await fetchData(ticker, signalConfig.windowLength + 50);
    }

    const { retUs, retJp, dates } = buildReturnMatrices(usData, jpData);

    if (retUs.length < signalConfig.windowLength) {
      return res.json({ error: 'データが不足しています', signals: [] });
    }

    // Compute C_full
    const combined = retUs.map((r, i) => [...r, ...retJp[i]]);
    const CFull = correlationMatrix(combined);

    // Compute signal
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

    // Create ranking
    const signals = JP_ETF_TICKERS.map((ticker, i) => ({
      ticker,
      name: JP_ETF_NAMES[ticker] || ticker,
      signal: signal[i],
      rank: 0
    })).sort((a, b) => b.signal - a.signal);

    signals.forEach((s, i) => s.rank = i + 1);

    // Get prices
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();
    const prices = {};

    for (const ticker of JP_ETF_TICKERS) {
      try {
        const quote = await yahooFinance.quote(ticker);
        prices[ticker] = quote.regularMarketPrice || 0;
      } catch (e) {
        prices[ticker] = 0;
      }
    }

    signals.forEach(s => {
      s.price = prices[s.ticker] || 0;
      s.priceFormatted = s.price > 0 ? `${s.price.toLocaleString()}円/口` : 'N/A';
    });

    // Buy/Sell candidates
    const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * signalConfig.quantile));
    const buyCandidates = signals.slice(0, buyCount);
    const sellCandidates = signals.slice(-buyCount);

    res.json({
      config: signalConfig,
      signals,
      buyCandidates,
      sellCandidates,
      latestDate: dates[dates.length - 1],
      metrics: {
        meanSignal: signal.reduce((a, b) => a + b, 0) / signal.length,
        stdSignal: Math.sqrt(
          signal.reduce((sq, x) => sq + Math.pow(x - signal.reduce((s, v) => s + v, 0) / signal.length, 2), 0
        ) / signal.length
      }
    });

  } catch (error) {
    logger.error('Signal generation failed', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
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

// Start server
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
