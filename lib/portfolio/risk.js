'use strict';

const { createLogger } = require('../logger');

const logger = createLogger('PortfolioRisk');

const { computePerformanceMetrics } = require('./metrics');

/**
 * リスク指標計算
 * Risk Metrics Functions
 */

/**
 * 取引コストを適用
 * @param {number} ret - リターン
 * @param {Object} costs - コスト設定
 * @param {number} costs.slippage - スリッページ率
 * @param {number} costs.commission - 手数料率
 * @param {Array<number>|undefined} prevWeights - 前期間のポートフォリオウェイト
 * @param {Array<number>|undefined} currWeights - 当期間のポートフォリオウェイト
 * @returns {number} コスト適用後のリターン
 */
function applyTransactionCosts(ret, costs, prevWeights, currWeights) {
  if (!costs) return ret;

  const slippage = costs.slippage || 0;
  const commission = costs.commission || 0;
  const totalCostRate = slippage + commission;

  if (!prevWeights || !currWeights) {
    return ret - totalCostRate * 2;
  }

  let turnover = 0;
  const n = Math.min(prevWeights.length, currWeights.length);
  for (let i = 0; i < n; i++) {
    turnover += Math.abs(currWeights[i] - prevWeights[i]);
  }
  turnover = turnover / 2;

  const cost = totalCostRate * turnover;
  return ret - cost;
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
  applyTransactionCosts,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdownDetail
};
