/**
 * lib/backtestUtils.js
 * バックテスト共通ユーティリティ関数
 * 複数スクリプト間で重複していた関数を集約
 *
 * 関連ファイル:
 * - scripts/backtest_improved.js
 * - scripts/calculate_real_profit_improved.js
 * - backtest/improved.js
 * - backtest/real.js
 */

'use strict';

const { JP_ETF_TICKERS, JP_ETF_NAMES } = require('./constants');

/**
 * ボラティリティ計算（年率化）
 * @param {number[]} returns - 日次リターン配列
 * @param {number} lookback - 計算期間（日）
 * @returns {number} 年率化ボラティリティ
 */
function calculateVolatility(returns, lookback) {
  if (returns.length < lookback) return 0;
  const slice = returns.slice(-lookback);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / slice.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * セクター別パフォーマンス計算
 * @param {Array} returnsJpOc - 日本 ETF OC リターン配列
 * @param {number} lookback - 評価期間（日）
 * @param {number} startDate - 評価開始インデックス
 * @returns {Object} セクター別パフォーマンス
 */
function calculateSectorPerformance(returnsJpOc, lookback, startDate) {
  const performance = {};
  JP_ETF_TICKERS.forEach((ticker, idx) => {
    const tickerReturns = [];
    for (let i = startDate; i < returnsJpOc.length; i++) {
      tickerReturns.push(returnsJpOc[i].values[idx]);
    }
    const wins = tickerReturns.filter(r => r > 0).length;
    const total = tickerReturns.length;
    const avgReturn = total > 0 ? tickerReturns.reduce((a, b) => a + b, 0) / total : 0;
    performance[ticker] = {
      ticker,
      name: JP_ETF_NAMES[ticker],
      winRate: total > 0 ? wins / total : 0,
      avgReturn,
      index: idx
    };
  });
  return performance;
}

/**
 * 除外銘柄リスト作成
 * @param {Object} sectorPerformance - セクター別パフォーマンス
 * @param {Object} sectorConfig - セクターフィルタ設定
 * @returns {Set<number>} 除外銘柄インデックスのセット
 */
function getExcludedTickers(sectorPerformance, sectorConfig) {
  if (!sectorConfig || !sectorConfig.sectorFilterEnabled) return new Set();
  const excluded = new Set();
  Object.values(sectorPerformance).forEach(sp => {
    if (sp.winRate < sectorConfig.sectorMinWinRate || sp.avgReturn < sectorConfig.sectorMinReturn) {
      excluded.add(sp.index);
    }
  });
  return excluded;
}

/**
 * ショート比率調整・セクターフィルタ付きポートフォリオ構築
 * @param {number[]} signal - シグナル配列
 * @param {number} quantile - 分位点
 * @param {number} shortRatio - ショート比率（0=ロングのみ）
 * @param {Set<number>} excludedIndices - 除外銘柄インデックス
 * @returns {number[]} ウェイト配列
 */
function buildPortfolioWithShortRatioAndFilter(signal, quantile, shortRatio, excludedIndices) {
  const n = signal.length;
  const q = Math.max(1, Math.floor(n * quantile));
  const ranked = signal
    .map((val, idx) => ({ val, idx }))
    .filter(x => !excludedIndices.has(x.idx))
    .sort((a, b) => a.val - b.val);

  if (ranked.length === 0) return new Array(n).fill(0);

  const adjustedQ = Math.min(q, Math.floor(ranked.length * quantile));
  const actualQ = Math.max(1, adjustedQ);

  const longIndices = ranked.slice(-actualQ).map(x => x.idx);
  const shortIndices = ranked.slice(0, actualQ).map(x => x.idx);

  const weights = new Array(n).fill(0);
  const longWeight = 1.0 / actualQ;
  const shortWeight = -(1.0 / actualQ) * shortRatio;

  for (const idx of longIndices) weights[idx] = longWeight;
  for (const idx of shortIndices) weights[idx] = shortWeight;

  return weights;
}

/**
 * モメンタム計算（期間平均リターン）
 * @param {Array} returnsJp - 日本 ETF CC リターン配列
 * @param {number} start - 開始インデックス
 * @param {number} end - 終了インデックス
 * @param {number} nJp - 銘柄数
 * @returns {number[]} モメンタム配列
 */
function averageMomentumWindow(returnsJp, start, end, nJp) {
  const momentum = new Array(nJp).fill(0);
  const window = end - start;
  for (let j = start; j < end; j++) {
    for (let k = 0; k < nJp; k++) {
      momentum[k] += returnsJp[j].values[k];
    }
  }
  for (let k = 0; k < nJp; k++) {
    momentum[k] /= window;
  }
  return momentum;
}

/**
 * ウェイト付きリターン計算
 * @param {number[]} weights - ウェイト配列
 * @param {number[]} returns - リターン配列
 * @returns {number} ポートフォリオリターン
 */
function weightedReturn(weights, returns) {
  let result = 0;
  for (let i = 0; i < weights.length; i++) {
    result += weights[i] * returns[i];
  }
  return result;
}

module.exports = {
  calculateVolatility,
  calculateSectorPerformance,
  getExcludedTickers,
  buildPortfolioWithShortRatioAndFilter,
  averageMomentumWindow,
  weightedReturn
};
