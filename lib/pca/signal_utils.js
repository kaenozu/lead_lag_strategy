'use strict';

const EPS = 1e-10;

function computeColumnMoments(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) {
    return { mean: [], std: [] };
  }
  const nSamples = matrix.length;
  const nCols = matrix[0].length;
  const mean = new Array(nCols).fill(0);
  const std = new Array(nCols).fill(0);

  for (let j = 0; j < nCols; j++) {
    let sum = 0;
    for (let i = 0; i < nSamples; i++) sum += matrix[i][j];
    mean[j] = sum / nSamples;

    let sumSq = 0;
    for (let i = 0; i < nSamples; i++) {
      const diff = matrix[i][j] - mean[j];
      sumSq += diff * diff;
    }
    std[j] = Math.sqrt(sumSq / nSamples) + EPS;
  }

  return { mean, std };
}

function zscore(value, mean, std) {
  return (value - mean) / (std || EPS);
}

function normalizeStd(signal) {
  if (!Array.isArray(signal) || signal.length === 0) return [];
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / n + EPS);
  if (std <= EPS) return signal.slice();
  return signal.map((s) => (s - mean) / std);
}

function normalizeMaxAbs(signal) {
  if (!Array.isArray(signal) || signal.length === 0) return [];
  const maxAbs = Math.max(...signal.map((s) => Math.abs(s)));
  if (maxAbs <= EPS) return signal.slice();
  return signal.map((s) => s / maxAbs);
}

/**
 * ローリング・ボラティリティ正規化シグナル
 * Rolling Volatility-Scaled Signal
 *
 * 数式:
 *   σ_t = std(signal[t-w .. t-1])              ← 直近 volWindow 期間の標準偏差
 *   signal_scaled[t] = signal[t] * (targetVol / max(σ_t, ε))
 *
 * 根拠:
 *   - COVID クラッシュ等の高ボラ局面でシグナルが過大になるのを防ぐ
 *   - 各 JP 銘柄シグナルの「単位」を統一 → 分位閾値が時系列に安定
 *   - 実証研究 (Moreira & Muir 2017) により vol-scaled リターンの
 *     Sharpe 改善が報告されている
 *
 * @param {number[]} signal      T 個のシグナル系列
 * @param {number}   volWindow   標準偏差計算の窓幅（デフォルト 21 営業日）
 * @param {number}   targetVol   目標ボラティリティ（デフォルト 1.0）
 * @returns {number[]} スケール済みシグナル
 */
function rollingVolScale(signal, volWindow = 21, targetVol = 1.0) {
  if (!Array.isArray(signal) || signal.length === 0) return [];
  const T = signal.length;
  const scaled = signal.slice();     // コピー

  for (let t = volWindow; t < T; t++) {
    const window = signal.slice(t - volWindow, t);
    // 標本標準偏差 (ddof=1): n > 1 が必要
    const n = window.length;
    if (n < 2) continue;
    const mean = window.reduce((a, b) => a + b, 0) / n;
    const variance = window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
    const sigma = Math.sqrt(variance);
    if (sigma > EPS) {
      scaled[t] = signal[t] * (targetVol / sigma);
    }
  }
  return scaled;
}

/**
 * 全 JP 銘柄のシグナル行列を列ごとにローリング・ボラティリティ正規化
 *
 * @param {number[][]} signalsMatrix  T × N_JP のシグナル行列
 * @param {number}     volWindow      標準偏差の窓幅
 * @param {number}     targetVol      目標ボラティリティ
 * @returns {number[][]} 正規化済みシグナル行列
 */
function applySignalVolNorm(signalsMatrix, volWindow = 21, targetVol = 1.0) {
  if (!Array.isArray(signalsMatrix) || signalsMatrix.length === 0) return [];
  const T = signalsMatrix.length;
  const N = signalsMatrix[0].length;

  // 列ごとに変換
  const cols = Array.from({ length: N }, (_, j) =>
    rollingVolScale(signalsMatrix.map((row) => row[j]), volWindow, targetVol)
  );

  // 行列に戻す
  return Array.from({ length: T }, (_, i) => cols.map((col) => col[i]));
}

module.exports = {
  EPS,
  computeColumnMoments,
  zscore,
  normalizeStd,
  normalizeMaxAbs,
  rollingVolScale,
  applySignalVolNorm
};
