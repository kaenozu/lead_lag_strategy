/**
 * 日米業種リードラグ戦略 - リスク管理強化版
 * 
 * 初心者向けに最大ドローダウンを抑制し、安定した収益を目指す
 */

const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const { LeadLagSignal } = require('../lib/pca');
const { buildPaperAlignedReturnRows } = require('../lib/data');
const { config: appConfig } = require('../lib/config');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');
const { computeCFull } = require('./common');

// ============================================================================
// 設定（リスク管理強化）
// ============================================================================

const BASE_CONFIG = {
  windowLength: 40,
  nFactors: 3,
  lambdaReg: 0.95,
  quantile: 0.4,
  warmupPeriod: 40
};

// リスク管理パラメータ
const RISK_CONFIG = {
  maxPositionSize: 0.10,      // 最大ポジションサイズ（10%）
  maxTotalExposure: 0.60,     // 最大エクスポージャー（60%）
  volatilityTarget: 0.08,     // 目標ボラティリティ（8%）
  maxDrawdownLimit: 0.10,     // 最大ドローダウン（10%）
  stopLoss: 0.05             // ストップロス（5%）
};

// 取引コスト
const TRANSACTION_COSTS = {
  slippage: 0.0005,           // スリッページ（0.05%）
  commission: 0.0003         // 手数料（0.03%）
};

const PARAM_GRID = {
  windowLength: [40, 60],
  lambdaReg: [0.9, 0.95],
  quantile: [0.3, 0.4]
};

// ============================================================================
// ポートフォリオ構築（リスク管理付き）
// ============================================================================

function buildPortfolio(signal, quantile = 0.4, riskConfig = null, currentVolatility = 0.10) {
  const n = signal.length;
  const q = Math.max(1, Math.floor(n * quantile));
  const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
  const longIdx = indexed.slice(-q).map(x => x.idx);
  const shortIdx = indexed.slice(0, q).map(x => x.idx);

  // 基本ウェイト
  const weights = new Array(n).fill(0);
  const w = 1.0 / q;
  for (const idx of longIdx) weights[idx] = w;
  for (const idx of shortIdx) weights[idx] = -w;

  // リスク管理適用
  if (riskConfig) {
    // ボラティリティ調整
    const volScale = riskConfig.volatilityTarget / Math.max(currentVolatility, 0.01);
    const adjustedScale = Math.min(volScale, 1.0);

    // 最大ポジション制限
    for (let i = 0; i < n; i++) {
      weights[i] *= adjustedScale;
      if (weights[i] > riskConfig.maxPositionSize) weights[i] = riskConfig.maxPositionSize;
      if (weights[i] < -riskConfig.maxPositionSize) weights[i] = -riskConfig.maxPositionSize;
    }

    // 総エクスポージャー制限
    const totalExposure = weights.reduce((s, w) => s + Math.abs(w), 0);
    if (totalExposure > riskConfig.maxTotalExposure) {
      const scale = riskConfig.maxTotalExposure / totalExposure;
      for (let i = 0; i < n; i++) weights[i] *= scale;
    }
  }

  return weights;
}

// ============================================================================
// データ取得・処理
// ============================================================================

async function fetchYahooFinanceData(ticker, startDate = '2018-01-01', endDate = '2025-12-31') {
  try {
    const queryOptions = { period1: startDate, period2: endDate, interval: '1d' };
    const result = await yahooFinance.chart(ticker, queryOptions);
    const data = result.quotes.map(q => ({
      date: q.date.toISOString().split('T')[0],
      open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
    })).filter(d => d.close !== null && d.close > 0);
    return data;
  } catch (e) {
    console.error(`  ${ticker} の取得エラー：${e.message}`);
    return [];
  }
}

async function fetchAllData(tickers, startDate, endDate) {
  const results = {};
  for (const ticker of tickers) {
    results[ticker] = await fetchYahooFinanceData(ticker, startDate, endDate);
  }
  return results;
}

function computeReturns(ohlc, type = 'cc') {
  if (type === 'cc') {
    const ret = [];
    let prev = null;
    for (const r of ohlc) {
      if (prev !== null) ret.push({ date: r.date, return: (r.close - prev) / prev });
      prev = r.close;
    }
    return ret;
  } else {
    return ohlc.filter(r => r.open > 0).map(r => ({
      date: r.date, return: (r.close - r.open) / r.open
    }));
  }
}

function buildMatrices(usData, jpData) {
  const usTickers = Object.keys(usData);
  const jpTickers = Object.keys(jpData);
  const usCC = {};
  const jpCC = {};
  const jpOC = {};
  for (const t of usTickers) usCC[t] = computeReturns(usData[t], 'cc');
  for (const t of jpTickers) {
    jpCC[t] = computeReturns(jpData[t], 'cc');
    jpOC[t] = computeReturns(jpData[t], 'oc');
  }

  const usMap = new Map();
  const jpCCMap = new Map();
  const jpOCMap = new Map();
  for (const t in usCC) {
    for (const r of usCC[t]) {
      if (!usMap.has(r.date)) usMap.set(r.date, {});
      usMap.get(r.date)[t] = r.return;
    }
  }
  for (const t in jpCC) {
    for (const r of jpCC[t]) {
      if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
      jpCCMap.get(r.date)[t] = r.return;
    }
    for (const r of jpOC[t]) {
      if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
      jpOCMap.get(r.date)[t] = r.return;
    }
  }

  return buildPaperAlignedReturnRows(
    usMap,
    jpCCMap,
    jpOCMap,
    usTickers,
    jpTickers,
    appConfig.backtest.jpWindowReturn
  );
}

// ============================================================================
// バックテスト（リスク管理付き）
// ============================================================================

function runStrategyWithRisk(retUs, retJp, retJpOc, config, labels, CFull, riskConfig) {
  const nJp = retJp[0].values.length;
  const results = [];
  const signalGen = new LeadLagSignal({
    ...config,
    orderedSectorKeys: appConfig.pca.orderedSectorKeys
  });
  const totalCost = TRANSACTION_COSTS.slippage + TRANSACTION_COSTS.commission;

  // リスク管理用変数
  let cumulative = 1;
  let runningMax = 1;
  let currentDrawdown = 0;
  let rollingVolatility = 0.10;
  const volWindow = 20;
  const recentReturns = [];

  for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
    const start = i - config.windowLength;
    const retUsWin = retUs.slice(start, i).map(r => r.values);
    const retJpWin = retJp.slice(start, i).map(r => r.values);
    const retUsLatest = retUs[i].values;

    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);

    // ボラティリティ計算
    if (recentReturns.length >= volWindow) {
      const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
      const variance = recentReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / recentReturns.length;
      rollingVolatility = Math.sqrt(variance) * Math.sqrt(252);
    }

    // ポートフォリオ構築（リスク管理付き）
    const weights = riskConfig ? buildPortfolio(signal, config.quantile, riskConfig, rollingVolatility) : buildPortfolio(signal, config.quantile);

    // ドローダウン制御
    if (riskConfig && currentDrawdown < -riskConfig.maxDrawdownLimit * 0.5) {
      const scale = currentDrawdown < -riskConfig.maxDrawdownLimit ? 0.2 : 0.5;
      for (let j = 0; j < nJp; j++) weights[j] *= scale;
    }

    const retNext = retJpOc[i].values;
    let stratRet = 0;
    for (let j = 0; j < nJp; j++) stratRet += weights[j] * retNext[j];

    // 取引コスト
    stratRet = stratRet - totalCost;

    results.push({ date: retJpOc[i].date, return: stratRet, weights: [...weights] });

    // ドローダウン更新
    cumulative *= (1 + stratRet);
    if (cumulative > runningMax) runningMax = cumulative;
    currentDrawdown = (cumulative - runningMax) / runningMax;

    // ボラティリティ履歴更新
    recentReturns.push(stratRet);
    if (recentReturns.length > volWindow) recentReturns.shift();
  }

  return results;
}

// ============================================================================
// パフォーマンス指標
// ============================================================================

function computeMetrics(returns) {
  if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0 };
  const ar = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
  const rr = risk > 0 ? ar / risk : 0;
  let cum = 1, rMax = 1, mdd = 0;
  for (const r of returns) {
    cum *= (1 + r);
    if (cum > rMax) rMax = cum;
    const dd = (cum - rMax) / rMax;
    if (dd < mdd) mdd = dd;
  }
  return { AR: ar * 100, RISK: risk * 100, RR: rr, MDD: mdd * 100, Total: (cum - 1) * 100 };
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('日米業種リードラグ戦略 - リスク管理強化版');
  console.log('='.repeat(70));

  const dataDir = path.join(__dirname, '..', 'data');
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // データ取得
  console.log('\n[1/4] Yahoo Finance からデータ取得中...');
  const usData = await fetchAllData(US_ETF_TICKERS, '2018-01-01', '2025-12-31');
  const jpData = await fetchAllData(JP_ETF_TICKERS, '2018-01-01', '2025-12-31');

  // データ処理
  console.log('[2/4] データ処理中...');
  const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
  console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

  const CFull = computeCFull(retUs, retJp);

  // パラメータ最適化（簡易）
  console.log('[3/4] パラメータ最適化中...');
  let bestConfig = { ...BASE_CONFIG };
  let bestRR = -Infinity;

  for (const l of PARAM_GRID.lambdaReg) {
    for (const w of PARAM_GRID.windowLength) {
      for (const q of PARAM_GRID.quantile) {
        const config = { ...BASE_CONFIG, lambdaReg: l, windowLength: w, quantile: q, warmupPeriod: w };
        const result = runStrategyWithRisk(retUs, retJp, retJpOc, config, SECTOR_LABELS, CFull, RISK_CONFIG);
        const metrics = computeMetrics(result.map(r => r.return));
        if (metrics.RR > bestRR && metrics.MDD > -20) {
          bestRR = metrics.RR;
          bestConfig = { ...config };
        }
      }
    }
  }
  console.log(`  最適パラメータ：λ=${bestConfig.lambdaReg}, window=${bestConfig.windowLength}, q=${bestConfig.quantile}`);

  // 戦略実行（リスク管理あり/なし）
  console.log('[4/4] 戦略実行中...\n');

  const resultNoRisk = runStrategyWithRisk(retUs, retJp, retJpOc, bestConfig, SECTOR_LABELS, CFull, null);
  const resultWithRisk = runStrategyWithRisk(retUs, retJp, retJpOc, bestConfig, SECTOR_LABELS, CFull, RISK_CONFIG);

  const metricsNoRisk = computeMetrics(resultNoRisk.map(r => r.return));
  const metricsWithRisk = computeMetrics(resultWithRisk.map(r => r.return));

  console.log('='.repeat(70));
  console.log('バックテスト結果');
  console.log('='.repeat(70));
  console.log('\nリスク管理なし:');
  console.log(`  AR: ${metricsNoRisk.AR.toFixed(2)}%, R/R: ${metricsNoRisk.RR.toFixed(2)}, MDD: ${metricsNoRisk.MDD.toFixed(2)}%`);
  console.log('\nリスク管理あり:');
  console.log(`  AR: ${metricsWithRisk.AR.toFixed(2)}%, R/R: ${metricsWithRisk.RR.toFixed(2)}, MDD: ${metricsWithRisk.MDD.toFixed(2)}%`);

  // 評価
  console.log('\n' + '='.repeat(70));
  console.log('評価');
  console.log('='.repeat(70));
  if (metricsWithRisk.RR > 0.5) console.log('✓ R/R 比が 0.5 以上（良好）');
  else if (metricsWithRisk.RR > 0) console.log('△ R/R 比が 0 以上（改善の余地あり）');
  else console.log('✗ R/R 比が負（戦略の見直しが必要）');

  if (metricsWithRisk.MDD > -15) console.log('✓ 最大ドローダウンが 15% 以内（良好）');
  else if (metricsWithRisk.MDD > -25) console.log('△ 最大ドローダウンが 25% 以内（許容範囲）');
  else console.log('✗ 最大ドローダウンが 25% 超（リスク管理の強化が必要）');

  // 結果保存
  const summary = [
    { name: 'RiskManaged', ...metricsWithRisk },
    { name: 'NoRiskManagement', ...metricsNoRisk }
  ];
  const csv = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Total (%)\n' +
        summary.map(s => `${s.name},${s.AR.toFixed(4)},${s.RISK.toFixed(4)},${s.RR.toFixed(4)},${s.MDD.toFixed(4)},${s.Total.toFixed(4)}`).join('\n');
  fs.writeFileSync(path.join(outputDir, 'backtest_summary_risk_managed.csv'), csv);

  console.log('\n結果を保存しました：results/backtest_summary_risk_managed.csv');
  console.log('='.repeat(70));
}

if (require.main === module) {
  main().catch(error => {
    const { createLogger } = require('../lib/logger');
    const logger = createLogger('BacktestRiskManaged');
    logger.error('Backtest failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}
