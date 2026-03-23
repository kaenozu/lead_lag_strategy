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
 * @returns {number[][]} 相関行列
 */
function correlationMatrix(data) {
  const { validateMatrix } = require('./validate');
  const { createLogger } = require('../logger');
  const logger = createLogger('CorrelationMatrix');
  
  validateMatrix(data);

  const n = data.length;
  const m = data[0].length;

  if (n < 2) {
    throw new Error('Need at least 2 samples to compute correlation');
  }

  // 平均の計算
  const means = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      means[j] += data[i][j];
    }
    means[j] /= n;
  }

  // 不偏標準偏差の計算（n-1）
  const stds = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = data[i][j] - means[j];
      sumSq += diff * diff;
    }
    // 不偏分散：n-1 で割る
    const variance = sumSq / (n - 1);
    stds[j] = Math.sqrt(variance);
    
    // ゼロ分散の警告
    if (stds[j] < 1e-10) {
      logger.warn(`Variable ${j} has near-zero standard deviation (std=${stds[j]})`);
    }
  }

  // 標準化
  const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      standardized[i][j] = stds[j] > 1e-10
        ? (data[i][j] - means[j]) / stds[j]
        : 0;
    }
  }

  // 相関行列（標準化後の内積を n-1 で割る＝標本ピアソン相関と整合）
  const dof = n - 1;
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

  // 対称性の強制（数値誤差の補正）
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const avg = (corr[i][j] + corr[j][i]) / 2;
      corr[i][j] = corr[j][i] = avg;
      
      // 相関係数の範囲チェック
      if (Math.abs(corr[i][j]) > 1.0001) {
        logger.warn(`Correlation out of range: [${i}][${j}] = ${corr[i][j]}`);
        corr[i][j] = corr[j][i] = Math.max(-1, Math.min(1, corr[i][j]));
      }
    }
  }

  return corr;
}

function correlationMatrixSample(data) {
  const { validateMatrix } = require('./validate');
  validateMatrix(data);

  const n = data.length;
  const m = data[0].length;

  if (n < 2) {
    throw new Error('Need at least 2 samples to compute sample correlation');
  }

  const dof = n - 1;
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
      const d = data[i][j] - means[j];
      sumSq += d * d;
    }
    stds[j] = Math.sqrt(sumSq / dof);
  }

  const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let cov = 0;
      for (let k = 0; k < n; k++) {
        cov += (data[k][i] - means[i]) * (data[k][j] - means[j]);
      }
      cov /= dof;
      const denom = stds[i] * stds[j];
      corr[i][j] = denom > 1e-10 ? cov / denom : 0;
    }
  }

  return corr;
}

module.exports = {
  mean,
  std,
  correlationMatrix,
  correlationMatrixSample
};