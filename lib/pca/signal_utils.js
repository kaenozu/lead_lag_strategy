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

module.exports = {
  EPS,
  computeColumnMoments,
  zscore,
  normalizeStd,
  normalizeMaxAbs
};
