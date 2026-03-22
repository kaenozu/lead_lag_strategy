'use strict';

const { createLogger } = require('../logger');

const logger = createLogger('PortfolioMetrics');

/**
 * パフォーマンス指標計算
 * Performance Metrics Functions
 */

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

module.exports = {
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics
};
