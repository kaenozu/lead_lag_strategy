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
  computePerformanceMetrics,
  applyTransactionCosts,
  computeYearlyPerformance
} = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchOhlcvDateRangeForTickers,
  loadCSV,
  buildPaperAlignedReturnRows
} = require('../lib/data');

const logger = createLogger('BacktestReal');

// ============================================================================
// 定数
// ============================================================================

const US_ETF_TICKERS = [
  'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'
];

const JP_ETF_TICKERS = [
  '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
  '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
  '1631.T', '1632.T', '1633.T'
];

const SECTOR_LABELS = {
  'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 'US_XLRE': 'cyclical',
  'US_XLK': 'defensive', 'US_XLP': 'defensive', 'US_XLU': 'defensive', 'US_XLV': 'defensive',
  'US_XLI': 'neutral', 'US_XLC': 'neutral', 'US_XLY': 'neutral',
  'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
  'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
  'JP_1619.T': 'neutral', 'JP_1620.T': 'neutral', 'JP_1622.T': 'neutral', 'JP_1623.T': 'neutral',
  'JP_1624.T': 'neutral', 'JP_1626.T': 'neutral', 'JP_1628.T': 'neutral', 'JP_1632.T': 'neutral',
  'JP_1633.T': 'neutral'
};

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

  return buildPaperAlignedReturnRows(
    usCCMap,
    jpCCMap,
    jpOCMap,
    usTickers,
    jpTickers,
    config.backtest.jpWindowReturn
  );
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

  // PCA_PLAIN は plainConfig（lambdaReg: 0）で LeadLagSignal と同等
  const signalGenerator = new LeadLagSignal(config);
  let prevWeights = null;

  for (let i = config.warmupPeriod; i < returnsJpOc.length; i++) {
    const windowStart = i - config.windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
    // 論文: 共分散は Wt={t-L..t-1}、米国ショックは「直前に観測可能な米国 CC」＝当行 i（日付整列済み）
    const retUsLatest = returnsUs[i].values;

    let weights;

    if (strategy === 'DOUBLE_SORT') {
      // ダブルソート：モメンタムと PCA を組み合わせ
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

    // ルックアヘッドバイアスを避けるため、t日の取引収益には始値-終値（OC）リターンを使用する。
    // シグナルはt-1の終値までのデータで生成されるため、t日の始値で取引しOCリターンを収益とすることが
    // 正しいアプローチ。終値-終値（CC）リターン（returnsJp[i]）は使用しないこと。
    const retNext = returnsJpOc[i].values;

    // ポートフォオリターン計算
    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }

    // 取引コスト（ターンオーバー基準。コスト 0 のときは論文の無摩擦と一致）
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
 * モメンタム戦略実行
 */
function runMomentumStrategy(returnsJp, returnsJpOc, window = 60, quantile = 0.4, transactionCosts) {
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
    // ルックアヘッドバイアスを避けるため、t日の取引収益には始値-終値（OC）リターンを使用する。
    // 終値-終値（CC）リターン（returnsJp[i]）は使用しないこと。
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
// ダブルソート
// ============================================================================

function buildDoubleSortPortfolio(momentumSignal, pcaSignal, quantile = 0.4) {
  const n = momentumSignal.length;
  const q = Math.max(1, Math.floor(n * quantile));

  const momentumRanked = momentumSignal.map((val, idx) => ({ val, idx }))
    .sort((a, b) => a.val - b.val);

  const pcaRanked = pcaSignal.map((val, idx) => ({ val, idx }))
    .sort((a, b) => a.val - b.val);

  const rankMap = new Map();
  for (let i = 0; i < n; i++) {
    const momIdx = momentumRanked[i].idx;
    const pcaIdx = pcaRanked[i].idx;
    if (!rankMap.has(momIdx)) rankMap.set(momIdx, 0);
    if (!rankMap.has(pcaIdx)) rankMap.set(pcaIdx, 0);
    rankMap.set(momIdx, rankMap.get(momIdx) + i);
    rankMap.set(pcaIdx, rankMap.get(pcaIdx) + i);
  }

  const combinedRank = Array.from(rankMap.entries())
    .map(([idx, rank]) => ({ idx, rank }))
    .sort((a, b) => a.rank - b.rank);

  const longIdx = combinedRank.slice(-q).map(x => x.idx);
  const shortIdx = combinedRank.slice(0, q).map(x => x.idx);

  const weights = new Array(n).fill(0);
  const w = 1.0 / q;
  for (const idx of longIdx) weights[idx] = w;
  for (const idx of shortIdx) weights[idx] = -w;

  return weights;
}

function buildEqualWeightPortfolio(n, longIndices, shortIndices) {
  const weights = new Array(n).fill(0);
  const w = 1.0 / longIndices.length;
  for (const idx of longIndices) weights[idx] = w;
  for (const idx of shortIndices) weights[idx] = -w;
  return weights;
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

  const dataDir = path.join(__dirname, 'data');
  const outputDir = path.join(__dirname, 'results');

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
    { name: 'PCA SUB', m: metricsSub }
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

if (require.main === module) {
  main().catch(error => {
    logger.error('Backtest failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { runBacktest, runMomentumStrategy };
