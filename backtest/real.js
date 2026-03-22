/**
 * 日米業種リードラグ戦略 - 実市場データ版（リファクタリング版）
 * 改善点：
 * 1. lib/ モジュールの使用（重複コード削除）
 * 2. エラーハンドリングの改善
 * 3. ロギングの統一
 * 4. パフォーマンス最適化
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ライブラリ
const { createLogger } = require('../lib/logger');
const { config, validate: validateConfig } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { SimpleLeadLagSignal, BetaBasedSignal } = require('../lib/pca/simple_signal');
const { DirectionalLeadLagSignal, SectorDirectionalSignal } = require('../lib/pca/directional_signal');
const { CrossCorrelationSignal, EnsembleCorrelationSignal, RiskParitySignal } = require('../lib/pca/correlation_signal');
const {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts,
  computeYearlyPerformance
} = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchWithRetry,
  loadCSV,
  saveCSV,
  buildPaperAlignedReturnRows
} = require('../lib/data');

const logger = createLogger('BacktestReal');

const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');

// ============================================================================
// データ取得
// ============================================================================

/**
 * Yahoo Finance からデータを取得（リトライ付き）
 */
async function fetchYahooFinanceData(ticker, startDate, endDate) {
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();

    const result = await fetchWithRetry(
      () => yahooFinance.chart(ticker, {
        period1: startDate,
        period2: endDate,
        interval: '1d'
      }),
      { maxRetries: 3, baseDelay: 1000 }
    );

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
    logger.warn(`Failed to fetch ${ticker}`, { error: error.message });
    return [];
  }
}

/**
 * 全銘柄のデータを取得
 */
async function fetchAllData(tickers, startDate, endDate) {
  const results = {};
  for (const ticker of tickers) {
    logger.info(`Fetching ${ticker}...`);
    results[ticker] = await fetchYahooFinanceData(ticker, startDate, endDate);
  }
  return results;
}

/**
 * ローカルデータ読み込み
 */
function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const data = loadCSV(filePath);
      results[ticker] = data.map(row => ({
        date: row.Date || row.date,
        open: row.Open || row.open,
        high: row.High || row.high,
        low: row.Low || row.low,
        close: row.Close || row.close,
        volume: row.Volume || row.volume || 0
      }));
      logger.info(`Loaded ${ticker}: ${results[ticker].length} days`);
    } else {
      logger.warn(`File not found: ${ticker}`);
      results[ticker] = [];
    }
  }
  return results;
}

// ============================================================================
// データ処理
// ============================================================================

/**
 * Close-to-Close リターンを計算
 */
function computeCCReturns(ohlcData) {
  const returns = [];
  let prevClose = null;

  for (const row of ohlcData) {
    if (prevClose !== null && prevClose > 0) {
      returns.push({
        date: row.date,
        return: (row.close - prevClose) / prevClose
      });
    }
    prevClose = row.close;
  }

  return returns;
}

/**
 * Open-to-Close リターンを計算
 */
function computeOCReturns(ohlcData) {
  return ohlcData
    .filter(r => r.open > 0)
    .map(r => ({
      date: r.date,
      return: (r.close - r.open) / r.open
    }));
}

/**
 * リターンマトリックスを構築
 */
function buildReturnMatrices(usData, jpData) {
  const usTickers = Object.keys(usData);
  const jpTickers = Object.keys(jpData);

  // リターン計算
  const usCCReturns = {};
  const jpCCReturns = {};
  const jpOCReturns = {};

  for (const t of usTickers) {
    usCCReturns[t] = computeCCReturns(usData[t]);
  }
  for (const t of jpTickers) {
    jpCCReturns[t] = computeCCReturns(jpData[t]);
    jpOCReturns[t] = computeOCReturns(jpData[t]);
  }

  // 日付マップ
  const usCCMap = new Map();
  const jpCCMap = new Map();
  const jpOCMap = new Map();

  for (const t in usCCReturns) {
    for (const r of usCCReturns[t]) {
      if (!usCCMap.has(r.date)) usCCMap.set(r.date, {});
      usCCMap.get(r.date)[t] = r.return;
    }
  }

  for (const t in jpCCReturns) {
    for (const r of jpCCReturns[t]) {
      if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
      jpCCMap.get(r.date)[t] = r.return;
    }
    for (const r of jpOCReturns[t]) {
      if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
      jpOCMap.get(r.date)[t] = r.return;
    }
  }

  const { retUs, retJp, retJpOc, dates } = buildPaperAlignedReturnRows(
    usCCMap,
    jpCCMap,
    jpOCMap,
    usTickers,
    jpTickers,
    config.backtest.jpWindowReturn
  );

  return { returnsUs: retUs, returnsJp: retJp, returnsJpOc: retJpOc, dates };
}

/**
 * 長期相関行列の計算
 */
function computeCFull(returnsUs, returnsJp) {
  const combined = returnsUs.slice(0, Math.min(returnsUs.length, returnsJp.length))
    .map((r, i) => [...r.values, ...returnsJp[i].values]);
  return correlationMatrixSample(combined);
}

// ============================================================================
// 戦略実行
// ============================================================================

/**
 * バックテスト実行
 */
function runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull, strategy = 'PCA_SUB') {
  const nJp = returnsJp[0].values.length;
  const strategyReturns = [];
  const dates = [];

  if (returnsUs.length === 0 || returnsJpOc.length === 0) {
    logger.warn('Empty returns data provided to runBacktest');
    return { returns: strategyReturns, dates };
  }

  const warmupStart = Math.max(config.warmupPeriod, config.windowLength);
  if (warmupStart >= returnsUs.length) {
    logger.warn(`Insufficient data: warmupStart=${warmupStart}, returnsUs.length=${returnsUs.length}`);
    return { returns: strategyReturns, dates };
  }

  let signalGenerator;
  let useDirectSignal = false;

  if (strategy === 'SIMPLE_LL') {
    signalGenerator = new SimpleLeadLagSignal(config);
    useDirectSignal = true;
  } else if (strategy === 'BETA_LL') {
    signalGenerator = new BetaBasedSignal(config);
    useDirectSignal = true;
  } else if (strategy === 'DIR_LL') {
    signalGenerator = new DirectionalLeadLagSignal(config);
    useDirectSignal = true;
  } else if (strategy === 'SECTOR_DIR_LL') {
    signalGenerator = new SectorDirectionalSignal(config);
    useDirectSignal = true;
  } else if (strategy === 'CROSS_CORR') {
    signalGenerator = new CrossCorrelationSignal(config);
    useDirectSignal = true;
  } else if (strategy === 'ENSEMBLE') {
    signalGenerator = new EnsembleCorrelationSignal(config);
    useDirectSignal = true;
  } else if (strategy === 'RISK_PARITY') {
    signalGenerator = new RiskParitySignal(config);
    useDirectSignal = true;
  } else {
    signalGenerator = new LeadLagSignal(config);
  }

  let prevWeights = null;

  for (let i = warmupStart; i < returnsJpOc.length; i++) {
    const windowStart = i - config.windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
    const retUsLatestIdx = i - 1;
    if (retUsLatestIdx < 0 || retUsLatestIdx >= returnsUs.length) {
      logger.warn(`Skipping index ${i}: retUsLatestIdx=${retUsLatestIdx} out of bounds`);
      continue;
    }
    const retUsLatest = returnsUs[retUsLatestIdx].values;

    let weights;

    if (strategy === 'DOUBLE_SORT') {
      const momentum = new Array(nJp).fill(0);
      for (let j = i - config.windowLength; j < i; j++) {
        for (let k = 0; k < nJp; k++) {
          momentum[k] += returnsJp[j].values[k];
        }
      }
      for (let k = 0; k < nJp; k++) {
        momentum[k] /= config.windowLength;
      }

      const pcaSignal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
      );
      weights = buildDoubleSortPortfolio(momentum, pcaSignal, config.quantile);
    } else if (strategy === 'EQUAL_WEIGHT') {
      const half = Math.floor(nJp / 2);
      const longIndices = Array.from({ length: half }, (_, i) => i);
      const shortIndices = Array.from({ length: half }, (_, i) => half + i);
      weights = buildEqualWeightPortfolio(nJp, longIndices, shortIndices);
    } else if (useDirectSignal) {
      const signal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
      );
      const allSame = signal.every((v) => v === signal[0]);
      if (allSame || strategy === 'DIR_LL') {
        const direction = signal[0];
        if (direction === 0) {
          weights = new Array(nJp).fill(0);
        } else {
          weights = new Array(nJp).fill(direction / nJp);
        }
      } else {
        weights = buildPortfolio(signal, config.quantile);
      }
    } else {
      const signal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
      );
      weights = buildPortfolio(signal, config.quantile);
    }

    const retNext = returnsJp[i].values;

    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }

    strategyRet = applyTransactionCosts(strategyRet, config.transactionCosts, prevWeights, weights);

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: strategyRet
    });
    dates.push(returnsJpOc[i].date);
  }

  return { returns: strategyReturns, dates };
}

/**
 * 週次リバランス戦略実行（取引コスト削減）
 */
function runWeeklyStrategy(returnsUs, returnsJp, config, sectorLabels, CFull, strategy = 'PCA_SUB') {
  const nJp = returnsJp[0].values.length;
  const strategyReturns = [];
  const dates = [];
  let prevWeights = null;
  let currentWeights = null;
  let lastRebalanceDay = -1;

  if (returnsUs.length === 0 || returnsJp.length === 0) {
    logger.warn('Empty returns data provided to runWeeklyStrategy');
    return { returns: strategyReturns, dates };
  }

  const warmupStart = Math.max(config.warmupPeriod || config.windowLength, config.windowLength);
  if (warmupStart >= returnsUs.length) {
    logger.warn(`Insufficient data: warmupStart=${warmupStart}`);
    return { returns: strategyReturns, dates };
  }

  let signalGenerator;
  if (strategy === 'CROSS_CORR') {
    signalGenerator = new CrossCorrelationSignal(config);
  } else if (strategy === 'ENSEMBLE') {
    signalGenerator = new EnsembleCorrelationSignal(config);
  } else if (strategy === 'RISK_PARITY') {
    signalGenerator = new RiskParitySignal(config);
  } else if (strategy === 'DIR_LL') {
    signalGenerator = new DirectionalLeadLagSignal(config);
  } else if (strategy === 'SIMPLE_LL') {
    signalGenerator = new SimpleLeadLagSignal(config);
  } else {
    signalGenerator = new LeadLagSignal(config);
  }

  for (let i = warmupStart; i < returnsJp.length; i++) {
    const isRebalanceDay = (i - warmupStart) % 5 === 0;

    if (isRebalanceDay) {
      const windowStart = i - config.windowLength;
      const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
      const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
      const retUsLatestIdx = i - 1;
      if (retUsLatestIdx < 0 || retUsLatestIdx >= returnsUs.length) {
        continue;
      }
      const retUsLatest = returnsUs[retUsLatestIdx].values;

      const signal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
      );

      const allSame = signal.every((v) => v === signal[0]);
      if (allSame) {
        currentWeights = new Array(nJp).fill(0);
      } else {
        currentWeights = buildPortfolio(signal, config.quantile);
      }

      lastRebalanceDay = i;
    } else {
      currentWeights = prevWeights ? prevWeights.slice() : new Array(nJp).fill(0);
    }

    const retNext = returnsJp[i].values;

    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += currentWeights[j] * retNext[j];
    }

    strategyRet = applyTransactionCosts(strategyRet, config.transactionCosts, prevWeights, currentWeights);

    prevWeights = currentWeights;

    strategyReturns.push({
      date: returnsJp[i].date,
      return: strategyRet
    });
    dates.push(returnsJp[i].date);
  }

  return { returns: strategyReturns, dates };
}

/**
 * モメンタム戦略実行
 */
function runMomentumStrategy(returnsJp, returnsJpOc, window = 60, quantile = 0.3, transactionCosts) {
  const nJp = returnsJp[0].values.length;
  const strategyReturns = [];
  const dates = [];
  let prevWeights = null;

  for (let i = window; i < returnsJpOc.length; i++) {
    const momentum = new Array(nJp).fill(0);
    for (let j = i - window; j < i; j++) {
      for (let k = 0; k < nJp; k++) {
        momentum[k] += returnsJp[j].values[k];
      }
    }
    for (let k = 0; k < nJp; k++) {
      momentum[k] /= window;
    }

    const weights = buildPortfolio(momentum, quantile);
    const retNext = returnsJpOc[i].values;

    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }

    strategyRet = applyTransactionCosts(strategyRet, transactionCosts, prevWeights, weights);

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: strategyRet
    });
    dates.push(returnsJpOc[i].date);
  }

  return { returns: strategyReturns, dates };
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
  logger.info('Backtest started');

  // 設定検証
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    logger.warn('Configuration warnings', { warnings: configErrors });
  }

  const dataDir = path.join(__dirname, '..', 'data');
  const outputDir = path.join(__dirname, '..', 'results');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const startDate = config.data.startDate;
  const endDate = config.data.endDate;

  let usData;
  let jpData;

  if (config.data.mode === 'csv') {
    logger.info('Loading market data from CSV (BACKTEST_DATA_MODE=csv)...');
    usData = loadLocalData(path.resolve(config.data.dataDir), US_ETF_TICKERS);
    jpData = loadLocalData(path.resolve(config.data.dataDir), JP_ETF_TICKERS);
  } else {
    logger.info('Fetching market data from Yahoo (BACKTEST_DATA_MODE=yahoo)...');
    usData = await fetchAllData(US_ETF_TICKERS, startDate, endDate);
    jpData = await fetchAllData(JP_ETF_TICKERS, startDate, endDate);

    logger.info('Saving data to CSV...');
    for (const t in usData) {
      const csv = 'Date,Open,High,Low,Close,Volume\n' +
        usData[t].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
      fs.writeFileSync(path.join(dataDir, `${t}.csv`), csv);
    }
    for (const t in jpData) {
      const csv = 'Date,Open,High,Low,Close,Volume\n' +
        jpData[t].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
      fs.writeFileSync(path.join(dataDir, `${t}.csv`), csv);
    }
  }

  // データ処理
  logger.info('Processing data...');
  const { returnsUs, returnsJp, returnsJpOc, dates } = buildReturnMatrices(usData, jpData);
  logger.info(`Trading days: ${dates.length}, Period: ${dates[0]} ~ ${dates[dates.length - 1]}`);

  if (dates.length < 100) {
    logger.error('Insufficient data');
    return;
  }

  // 長期相関行列
  const CFull = computeCFull(returnsUs, returnsJp);

  // 戦略実行
  logger.info('Running strategies...');

  // PCA SUB（デフォルト）
  const backtestConfig = {
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    warmupPeriod: config.backtest.windowLength,
    transactionCosts: config.backtest.transactionCosts,
    orderedSectorKeys: config.pca.orderedSectorKeys
  };

  const resultsSub = runBacktest(returnsUs, returnsJp, returnsJpOc, backtestConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const metricsSub = computePerformanceMetrics(resultsSub.returns.map(r => r.return));

  // PCA PLAIN（λ=0）
  const plainConfig = { ...backtestConfig, lambdaReg: 0 };
  const resultsPlain = runBacktest(returnsUs, returnsJp, returnsJpOc, plainConfig, SECTOR_LABELS, CFull, 'PCA_PLAIN');
  const metricsPlain = computePerformanceMetrics(resultsPlain.returns.map(r => r.return));

  // MOM（モメンタム）
  const resultsMom = runMomentumStrategy(
    returnsJp, returnsJpOc,
    backtestConfig.windowLength,
    backtestConfig.quantile,
    backtestConfig.transactionCosts
  );
  const metricsMom = computePerformanceMetrics(resultsMom.returns.map(r => r.return));

  // SIMPLE LEAD-LAG
  const resultsSimple = runBacktest(returnsUs, returnsJp, returnsJpOc, backtestConfig, SECTOR_LABELS, CFull, 'SIMPLE_LL');
  const metricsSimple = computePerformanceMetrics(resultsSimple.returns.map(r => r.return));

  // BETA-BASED LEAD-LAG
  const resultsBeta = runBacktest(returnsUs, returnsJp, returnsJpOc, backtestConfig, SECTOR_LABELS, CFull, 'BETA_LL');
  const metricsBeta = computePerformanceMetrics(resultsBeta.returns.map(r => r.return));

  // DIRECTIONAL LEAD-LAG
  const resultsDir = runBacktest(returnsUs, returnsJp, returnsJpOc, backtestConfig, SECTOR_LABELS, CFull, 'DIR_LL');
  const metricsDir = computePerformanceMetrics(resultsDir.returns.map(r => r.return));

  // SECTOR DIRECTIONAL LEAD-LAG
  const resultsSectorDir = runBacktest(returnsUs, returnsJp, returnsJpOc, backtestConfig, SECTOR_LABELS, CFull, 'SECTOR_DIR_LL');
  const metricsSectorDir = computePerformanceMetrics(resultsSectorDir.returns.map(r => r.return));

  // 結果表示
  logger.info('Backtest completed');
  console.log('\n' + '='.repeat(70));
  console.log('Strategy Comparison Summary');
  console.log('='.repeat(70));
  console.log(
    'Strategy'.padEnd(15) +
    'AR (%)'.padStart(10) +
    'RISK (%)'.padStart(10) +
    'R/R'.padStart(8) +
    'MDD (%)'.padStart(10) +
    'Total (%)'.padStart(12)
  );
  console.log('-'.repeat(70));

  const summary = [
    { name: 'MOM', m: metricsMom },
    { name: 'PCA PLAIN', m: metricsPlain },
    { name: 'PCA SUB', m: metricsSub },
    { name: 'SIMPLE LL', m: metricsSimple },
    { name: 'BETA LL', m: metricsBeta },
    { name: 'DIR LL', m: metricsDir },
    { name: 'SECTOR DIR', m: metricsSectorDir }
  ];

  for (const { name, m } of summary) {
    console.log(
      name.padEnd(15) +
      (m.AR * 100).toFixed(2).padStart(10) +
      (m.RISK * 100).toFixed(2).padStart(10) +
      m.RR.toFixed(2).padStart(8) +
      (m.MDD * 100).toFixed(2).padStart(10) +
      ((m.Cumulative - 1) * 100).toFixed(2).padStart(12)
    );
  }

  // 結果保存
  const summaryCSV = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Total (%)\n' +
    summary.map(s =>
      `${s.name},${(s.m.AR * 100).toFixed(4)},${(s.m.RISK * 100).toFixed(4)},${s.m.RR.toFixed(4)},${(s.m.MDD * 100).toFixed(4)},${((s.m.Cumulative - 1) * 100).toFixed(4)}`
    ).join('\n');
  fs.writeFileSync(path.join(outputDir, 'backtest_summary_real.csv'), summaryCSV);

  // 累積リターン
  for (const { name, m } of summary) {
    const strat = name === 'MOM' ? resultsMom : name === 'PCA PLAIN' ? resultsPlain : resultsSub;
    let cum = 1;
    const cumData = strat.returns.map(r => {
      cum *= (1 + r.return);
      return { date: r.date, cumulative: cum };
    });
    const csv = 'Date,Cumulative\n' +
      cumData.map(r => `${r.date},${r.cumulative.toFixed(6)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, `cumulative_${name.toLowerCase().replace(' ', '_')}.csv`), csv);
  }

  logger.info('Results saved', { outputDir });
}

main().catch(error => {
  logger.error('Backtest failed', { error: error.message, stack: error.stack });
  process.exit(1);
});
