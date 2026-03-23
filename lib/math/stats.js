'use strict';

const { validateVector } = require('./validate');

function mean(v) {
  validateVector(v);
  return v.reduce((sum, val) => sum + val, 0) / v.length;
}

function std(v) {
  validateVector(v);

  if (v.length === 0) {
    return 0;
  }

  if (v.length < 2) {
    return 0;
  }

  const m = mean(v);
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    const diff = v[i] - m;
    sumSq += diff * diff;
  }

  return Math.sqrt(sumSq / (v.length - 1));
}

/**
 * 相関行列の計算（標本相関・不偏分散版）
 * Sample correlation matrix with unbiased variance (n-1)
 * 
 * @param {number[][]} data - 各行が観測、各列が変数の行列
 * @param {Object} opts - オプション
 * @param {boolean} opts.useUnbiased - 不偏推定量を使用（デフォルト: true）
 * @param {boolean} opts.warnOnZeroStd - ゼロ標準偏差で警告
 * @returns {number[][]} 相関行列
 */
function correlationMatrix(data, opts = {}) {
  const { validateMatrix } = require('./validate');
  const { createLogger } = require('../logger');
  const logger = createLogger('CorrelationMatrix');
  
  const { useUnbiased = true, warnOnZeroStd = true } = opts;
  
  validateMatrix(data);

  const n = data.length;
  const m = data[0].length;

  if (n < 2) {
    throw new Error('Need at least 2 samples to compute correlation');
  }

  const dof = useUnbiased ? n - 1 : n;
  
  const means = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      means[j] += data[i][j];
    }
    means[j] /= n;
  }

  const stds = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = data[i][j] - means[j];
      sumSq += diff * diff;
    }
    stds[j] = Math.sqrt(sumSq / dof);
    
    if (warnOnZeroStd && stds[j] < 1e-10) {
      logger.warn(`Variable ${j} has near-zero standard deviation (std=${stds[j]})`);
    }
  }

  const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      standardized[i][j] = stds[j] > 1e-10
        ? (data[i][j] - means[j]) / stds[j]
        : 0;
    }
  }

  const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));

  for (let i = 0; i < m; i++) {
    let sumDiag = 0;
    for (let k = 0; k < n; k++) {
      sumDiag += standardized[k][i] * standardized[k][i];
    }
    corr[i][i] = dof > 0 ? sumDiag / dof : 1;

    for (let j = i + 1; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += standardized[k][i] * standardized[k][j];
      }
      const corrIJ = dof > 0 ? sum / dof : 0;
      corr[i][j] = corrIJ;
      corr[j][i] = corrIJ;
    }
  }

  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const avg = (corr[i][j] + corr[j][i]) / 2;
      corr[i][j] = corr[j][i] = avg;
      
      if (Math.abs(corr[i][j]) > 1.0001) {
        logger.warn(`Correlation out of range: [${i}][${j}] = ${corr[i][j]}`);
        corr[i][j] = corr[j][i] = Math.max(-1, Math.min(1, corr[i][j]));
      }
    }
  }

  return corr;
}

/**
 * 相関行列の計算（母集団 Coventry-Clarke 推定量）
 * Covariance-based correlation matrix (n denominator)
 * 
 * @param {number[][]} data - 各行が観測、各列が変数の行列
 * @returns {number[][]} 相関行列
 */
function correlationMatrixSample(data) {
  return correlationMatrix(data, { useUnbiased: false, warnOnZeroStd: false });
}

module.exports = {
  mean,
  std,
  correlationMatrix,
  correlationMatrixSample
};