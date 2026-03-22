/**
 * ポートフォリオ構築ユーティリティ
 * Portfolio Building Utilities with Enhanced Performance
 */

'use strict';

const { createLogger } = require('./logger');

const logger = createLogger('Portfolio');

/**
 * ロングショートポートフォリオの構築
 * @param {Array<number>} signal - シグナル配列
 * @param {number} quantile - 分位点（0.0 - 0.5）
 * @returns {Array<number>} ポートフォリオウェイト
 */
function buildPortfolio(signal, quantile = 0.3) {
  if (!signal || signal.length === 0) {
    throw new Error('Invalid signal: signal is empty or null');
  }
  if (quantile <= 0 || quantile > 0.5) {
    throw new Error('Invalid quantile: must be between 0 and 0.5');
  }

  const n = signal.length;
  const q = Math.max(1, Math.floor(n * quantile));

  // シグナルのインデックスをソート（タイブレーク：インデックス順）
  const indexed = signal.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => {
    if (Math.abs(a.val - b.val) < 1e-10) {
      return a.idx - b.idx;
    }
    return a.val - b.val;
  });

  const longIdx = indexed.slice(-q).map(x => x.idx);
  const shortIdx = indexed.slice(0, q).map(x => x.idx);

  // 等ウェイト
  const weights = new Array(n).fill(0);
  const longWeight = 1.0 / q;
  const shortWeight = -1.0 / q;

  for (const idx of longIdx) {
    weights[idx] = longWeight;
  }
  for (const idx of shortIdx) {
    weights[idx] = shortWeight;
  }

  return weights;
}

/**
 * ダブルソートポートフォリオの構築
 * @param {Array<number>} momentumSignal - モメンタムシグナル
 * @param {Array<number>} pcaSignal - PCA シグナル
 * @param {number} quantile - 分位点
 * @returns {Array<number>} ポートフォリオウェイト
 */
function buildDoubleSortPortfolio(momentumSignal, pcaSignal, quantile = 0.3) {
  if (!momentumSignal || !pcaSignal) {
    throw new Error('Invalid input: signals are missing');
  }
  if (momentumSignal.length !== pcaSignal.length) {
    throw new Error('Signal dimension mismatch');
  }

  const n = momentumSignal.length;
  const q = Math.max(1, Math.floor(n * quantile));

  // モメンタムでソート
  const momentumRanked = momentumSignal.map((val, idx) => ({ val, idx }))
    .sort((a, b) => a.val - b.val);

  // PCA でソート
  const pcaRanked = pcaSignal.map((val, idx) => ({ val, idx }))
    .sort((a, b) => a.val - b.val);

  // 両方のランキングを組み合わせ（平均ランク）
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
  const longWeight = 1.0 / q;
  const shortWeight = -1.0 / q;

  for (const idx of longIdx) weights[idx] = longWeight;
  for (const idx of shortIdx) weights[idx] = shortWeight;

  return weights;
}

/**
 * 等ウェイトポートフォリオの構築
 * @param {number} n - 銘柄数
 * @param {Array<number>} longIndices - ロング銘柄インデックス
 * @param {Array<number>} shortIndices - ショート銘柄インデックス
 * @returns {Array<number>} ポートフォリオウェイト
 */
function buildEqualWeightPortfolio(n, longIndices, shortIndices) {
  if (n <= 0) {
    throw new Error('Invalid n: must be positive');
  }
  if (!longIndices || longIndices.length === 0) {
    throw new Error('Invalid longIndices: cannot be empty');
  }

  const weights = new Array(n).fill(0);
  const w = 1.0 / longIndices.length;

  for (const idx of longIndices) weights[idx] = w;
  for (const idx of shortIndices) weights[idx] = -w;

  return weights;
}

/**
 * パフォーマンス指標の計算（最適化版）
 * @param {Array<number>} returns - リターン系列
 * @param {number} annualizationFactor - 年率換算係数（デフォルト：252）
 * @returns {Object} パフォーマンス指標
 */
function computePerformanceMetrics(returns, annualizationFactor = 252) {
  if (!returns || returns.length === 0) {
    return {
      AR: 0,
      RISK: 0,
      RR: 0,
      MDD: 0,
      Cumulative: 1
    };
  }

  const n = returns.length;

  // 年率リターン（1 回で計算）
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += returns[i];
  }
  const ar = (sum / n) * annualizationFactor;

  // 年率リスク（標準偏差）
  const mean = sum / n;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = returns[i] - mean;
    sumSq += diff * diff;
  }
  const variance = sumSq / (n - 1);
  const risk = Math.sqrt(variance) * Math.sqrt(annualizationFactor);

  // リスク・リターン比
  const rr = risk > 0 ? ar / risk : 0;

  // 最大ドローダウン（1 パスで計算）
  let cumulative = 1;
  let runningMax = 1;
  let maxDrawdown = 0;

  for (let i = 0; i < n; i++) {
    cumulative *= (1 + returns[i]);
    if (cumulative > runningMax) {
      runningMax = cumulative;
    }
    const dd = (cumulative - runningMax) / runningMax;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
    }
  }

  return {
    AR: ar,
    RISK: risk,
    RR: rr,
    MDD: maxDrawdown,
    Cumulative: cumulative
  };
}

/**
 * 年別パフォーマンスの計算
 * @param {Array<Object>} results - 日次リターン結果 [{ date: string, return: number }]
 * @returns {Object} 年別パフォーマンス指標
 */
function computeYearlyPerformance(results) {
  if (!results || results.length === 0) {
    return {};
  }

  const yearlyData = {};

  for (const r of results) {
    const year = r.date?.substring(0, 4);
    if (!year) continue;

    if (!yearlyData[year]) {
      yearlyData[year] = [];
    }
    yearlyData[year].push(r.return);
  }

  const yearlyMetrics = {};
  for (const [year, returns] of Object.entries(yearlyData)) {
    yearlyMetrics[year] = computePerformanceMetrics(returns);
  }

  return yearlyMetrics;
}

/**
 * ローリングウィンドウ分析
 * @param {Array<Object>} returns - 日次リターン [{ date: string, return: number }]
 * @param {number} window - ウィンドウサイズ（日数）
 * @returns {Array<Object>} ローリング指標
 */
function computeRollingMetrics(returns, window = 252) {
  if (!returns || returns.length < window) {
    return [];
  }

  const rollingMetrics = [];

  for (let i = window; i <= returns.length; i++) {
    const windowReturns = returns.slice(i - window, i).map(r => r.return);
    const metrics = computePerformanceMetrics(windowReturns);
    rollingMetrics.push({
      endIndex: i,
      date: returns[i - 1]?.date || `Day ${i}`,
      RR: metrics.RR,
      AR: metrics.AR,
      MDD: metrics.MDD
    });
  }

  return rollingMetrics;
}

/**
 * 取引コストを適用
 * @param {number} ret - リターン
 * @param {Object} costs - コスト設定
 * @param {number} costs.slippage - スリッページ率
 * @param {number} costs.commission - 手数料率
 * @returns {number} コスト適用後のリターン
 */
function applyTransactionCosts(ret, costs) {
  if (!costs) return ret;

  const slippage = costs.slippage || 0;
  const commission = costs.commission || 0;
  const totalCost = slippage + commission;

  // ポートフォリオのターンオーバーを考慮（簡易的に 2 倍）
  return ret - totalCost * 2;
}

/**
 * シャープレシオの計算
 * @param {Array<number>} returns - リターン系列
 * @param {number} riskFreeRate - リスクフリーレート（年率）
 * @param {number} annualizationFactor - 年率換算係数
 * @returns {number} シャープレシオ
 */
function computeSharpeRatio(returns, riskFreeRate = 0, annualizationFactor = 252) {
  if (!returns || returns.length === 0) {
    return 0;
  }

  const metrics = computePerformanceMetrics(returns, annualizationFactor);
  if (metrics.RISK === 0) {
    return 0;
  }

  return (metrics.AR - riskFreeRate) / metrics.RISK;
}

/**
 * ソルティノレシオの計算
 * @param {Array<number>} returns - リターン系列
 * @param {number} targetReturn - 目標リターン（年率）
 * @param {number} annualizationFactor - 年率換算係数
 * @returns {number} ソルティノレシオ
 */
function computeSortinoRatio(returns, targetReturn = 0, annualizationFactor = 252) {
  if (!returns || returns.length === 0) {
    return 0;
  }

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const ar = mean * annualizationFactor;

  // 下方偏差の計算
  let downsideSum = 0;
  let downsideCount = 0;
  const dailyTarget = targetReturn / annualizationFactor;

  for (let i = 0; i < n; i++) {
    const diff = returns[i] - dailyTarget;
    if (diff < 0) {
      downsideSum += diff * diff;
      downsideCount++;
    }
  }

  if (downsideCount === 0) {
    return ar > 0 ? Infinity : 0;
  }

  const downsideDev = Math.sqrt(downsideSum / n) * Math.sqrt(annualizationFactor);
  return (ar - targetReturn) / downsideDev;
}

/**
 * 最大ドローダウンの詳細計算
 * @param {Array<number>} returns - リターン系列
 * @returns {Object} { MDD: number, start: number, end: number, recovery: number|null }
 */
function computeMaxDrawdownDetail(returns) {
  if (!returns || returns.length === 0) {
    return { MDD: 0, start: 0, end: 0, recovery: null };
  }

  let cumulative = 1;
  let runningMax = 1;
  let maxDrawdown = 0;
  let peakIdx = 0;
  let troughIdx = 0;
  let recoveryIdx = null;

  for (let i = 0; i < returns.length; i++) {
    cumulative *= (1 + returns[i]);

    if (cumulative > runningMax) {
      runningMax = cumulative;
      peakIdx = i;
    }

    const dd = (cumulative - runningMax) / runningMax;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      troughIdx = i;
    }

    // 回復のチェック
    if (maxDrawdown < 0 && cumulative >= runningMax && recoveryIdx === null && i > troughIdx) {
      recoveryIdx = i;
    }
  }

  return {
    MDD: maxDrawdown,
    start: peakIdx,
    end: troughIdx,
    recovery: recoveryIdx
  };
}

module.exports = {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio,
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics,
  applyTransactionCosts,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdownDetail
};
