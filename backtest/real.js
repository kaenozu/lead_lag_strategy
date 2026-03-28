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

// ライブラリ（パスは backtest/ からの相対）
const { createLogger } = require('../lib/logger');
const { config, validate: validateConfig } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts
} = require('../lib/portfolio');
const {
  fetchOhlcvDateRangeForTickers,
  loadCSV
} = require('../lib/data');
const {
  buildReturnMatricesFromOhlcv,
  computeCFull,
  capPositionWeights,
  smoothWeights,
  turnover,
  printStrategySummary,
  writeOhlcvCsvByTicker,
  writeStrategyOutputs
} = require('./common');
const {
  US_ETF_TICKERS,
  JP_ETF_TICKERS,
  SECTOR_LABELS
} = require('../lib/constants');
const { averageMomentumWindow, weightedReturn } = require('../lib/backtestUtils');

const logger = createLogger('BacktestReal');

// ============================================================================
// データ取得
// ============================================================================

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

  // PCA_PLAIN は plainConfig（lambdaReg: 0）で LeadLagSignal と同等
  const signalGenerator = new LeadLagSignal(config);
  let prevWeights = null;

  // 連続損失ルール：カウンターとポジションサイズ
  let consecutiveLoss = 0;
  let positionSize = 1.0;
  const consecutiveLossThreshold = Number(config?.consecutiveLoss?.threshold || 0);
  const consecutiveLossReduction = Number(config?.consecutiveLoss?.reduction || 0);

  for (let i = config.warmupPeriod; i < returnsJpOc.length; i++) {
    const windowStart = i - config.windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
    // 論文: 共分散は Wt={t-L..t-1}、米国ショックは「直前に観測可能な米国 CC」＝t-1 日のデータ
    // 注意：returnsUs[i] は t 日の米国リターンであり、日本市場が営業中の t 日には観測できない
    // したがって、returnsUs[i-1]（t-1 日の米国リターン）を使用する
    const retUsLatest = returnsUs[i - 1].values;

    let weights;

    if (strategy === 'DOUBLE_SORT') {
      // ダブルソート：モメンタムと PCA を組み合わせ
      const momentum = averageMomentumWindow(returnsJp, i - config.windowLength, i, nJp);

      const pcaSignal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
      );
      weights = buildDoubleSortPortfolio(momentum, pcaSignal, config.quantile);
    } else if (strategy === 'EQUAL_WEIGHT') {
      // 単純平均
      const half = Math.floor(nJp / 2);
      const longIndices = Array.from({ length: half }, (_, i) => i);
      const shortIndices = Array.from({ length: half }, (_, i) => half + i);
      weights = buildEqualWeightPortfolio(nJp, longIndices, shortIndices);
    } else {
      // PCA ベース戦略
      const signal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
      );
      weights = buildPortfolio(signal, config.quantile);
    }

    // シグナル平滑化＋ポジション上限
    const smoothingAlpha = Number(config?.signalStability?.smoothingAlpha || 0);
    weights = smoothWeights(prevWeights, weights, smoothingAlpha);
    weights = capPositionWeights(weights, Number(config?.riskLimits?.maxAbsWeight || 1));

    // ターンオーバー制限（高回転日の過剰売買を回避）
    const maxTurnoverPerDay = Number(config?.signalStability?.maxTurnoverPerDay || 1);
    const todayTurnover = turnover(prevWeights, weights);
    if (prevWeights && Number.isFinite(maxTurnoverPerDay) && maxTurnoverPerDay > 0 && todayTurnover > maxTurnoverPerDay) {
      // 売買のみ抑制し、当日の損益計上は継続する（前日ポジションを維持）
      weights = prevWeights;
    }

    // ルックアヘッドバイアスを避けるため、t日の取引収益には始値-終値（OC）リターンを使用する。
    // シグナルはt-1の終値までのデータで生成されるため、t日の始値で取引しOCリターンを収益とすることが
    // 正しいアプローチ。終値-終値（CC）リターン（returnsJp[i]）は使用しないこと。
    const retNext = returnsJpOc[i].values;

    // ポートフォオリターン計算
    let strategyRet = weightedReturn(weights, retNext);

    // 取引コスト（ターンオーバー基準。コスト 0 のときは論文の無摩擦と一致）
    strategyRet = applyTransactionCosts(strategyRet, config.transactionCosts, prevWeights, weights);

    // 日次損失ストップ（簡易）
    const dailyLossStop = Number(config?.riskLimits?.dailyLossStop || 0);
    if (Number.isFinite(dailyLossStop) && dailyLossStop > 0) {
      strategyRet = Math.max(strategyRet, -dailyLossStop);
    }

    // 連続損失ルール：ポジションサイズ調整
    if (Number.isFinite(consecutiveLossThreshold) && consecutiveLossThreshold > 0) {
      if (strategyRet < 0) {
        consecutiveLoss++;
        if (consecutiveLoss >= consecutiveLossThreshold) {
          // 閾値に達した場合、ポジションを削減
          positionSize = 1.0 - consecutiveLossReduction;
        }
      } else {
        // 利益が出た場合はリセット
        consecutiveLoss = 0;
        positionSize = 1.0;
      }
      // ポジションサイズを適用
      strategyRet = strategyRet * positionSize;
    }

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
 * モメンタム戦略実行
 */
function runMomentumStrategy(returnsJp, returnsJpOc, window = 60, quantile = 0.4, transactionCosts) {
  const nJp = returnsJp[0].values.length;
  const strategyReturns = [];
  const dates = [];
  let prevWeights = null;

  for (let i = window; i < returnsJpOc.length; i++) {
    const momentum = averageMomentumWindow(returnsJp, i - window, i, nJp);

    const weights = buildPortfolio(momentum, quantile);
    // ルックアヘッドバイアスを避けるため、t日の取引収益には始値-終値（OC）リターンを使用する。
    // 終値-終値（CC）リターン（returnsJp[i]）は使用しないこと。
    const retNext = returnsJpOc[i].values;

    let strategyRet = weightedReturn(weights, retNext);

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
    logger.info(`Fetching market data (BACKTEST_DATA_MODE=${config.data.mode})...`);
    const [usRes, jpRes] = await Promise.all([
      fetchOhlcvDateRangeForTickers(US_ETF_TICKERS, startDate, endDate, config),
      fetchOhlcvDateRangeForTickers(JP_ETF_TICKERS, startDate, endDate, config)
    ]);
    usData = usRes.byTicker;
    jpData = jpRes.byTicker;

    logger.info('Saving data to CSV...');
    writeOhlcvCsvByTicker(dataDir, usData);
    writeOhlcvCsvByTicker(dataDir, jpData);
  }

  // データ処理
  logger.info('Processing data...');
  const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc, dates } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    config.backtest.jpWindowReturn
  );
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
    orderedSectorKeys: config.pca.orderedSectorKeys,
    signalStability: {
      smoothingAlpha: config.backtest.smoothingAlpha,
      maxTurnoverPerDay: config.backtest.maxTurnoverPerDay
    },
    riskLimits: {
      maxAbsWeight: config.backtest.maxAbsWeight,
      dailyLossStop: config.backtest.dailyLossStop
    },
    consecutiveLoss: {
      threshold: config.backtest.consecutiveLoss?.threshold,
      reduction: config.backtest.consecutiveLoss?.reduction
    }
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

  const summary = [
    { name: 'MOM', m: metricsMom },
    { name: 'PCA PLAIN', m: metricsPlain },
    { name: 'PCA SUB', m: metricsSub }
  ];
  logger.info('Backtest completed');
  printStrategySummary(summary);
  writeStrategyOutputs(
    outputDir,
    summary,
    [
      { name: 'MOM', returns: resultsMom.returns },
      { name: 'PCA PLAIN', returns: resultsPlain.returns },
      { name: 'PCA SUB', returns: resultsSub.returns }
    ]
  );
  logger.info('Results saved', { outputDir });
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Backtest failed', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    const exitCode = error.code === 'INSUFFICIENT_DATA' ? 2 : 1;
    process.exit(exitCode);
  });
}

module.exports = { runBacktest, runMomentumStrategy };
