'use strict';

/**
 * ポートフォリオ構築
 * Portfolio Building Functions
 */

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

  const allSame = signal.every((v) => v === signal[0]);
  if (allSame) {
    throw new Error('Invalid signal: all values are identical');
  }

  const indexed = signal.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => {
    if (Math.abs(a.val - b.val) < 1e-10) {
      return a.idx - b.idx;
    }
    return a.val - b.val;
  });

  const longIdx = indexed.slice(-q).map(x => x.idx);
  const shortIdx = indexed.slice(0, q).map(x => x.idx);

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
  if (momentumSignal.length === 0 || pcaSignal.length === 0) {
    throw new Error('Invalid input: signals are empty');
  }
  if (momentumSignal.length !== pcaSignal.length) {
    throw new Error('Signal dimension mismatch');
  }
  if (quantile <= 0 || quantile > 0.5) {
    throw new Error('Invalid quantile: must be between 0 and 0.5');
  }

  const n = momentumSignal.length;
  const q = Math.max(1, Math.floor(n * quantile));

  const allSame = momentumSignal.every((v, i) => v === momentumSignal[0]) &&
                  pcaSignal.every((v, i) => v === pcaSignal[0]);
  if (allSame) {
    throw new Error('Invalid input: all signal values are identical');
  }

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

module.exports = {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio
};
