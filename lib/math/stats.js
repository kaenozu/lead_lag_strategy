'use strict';

const { validateVector, validateMatrix } = require('./validate');
const { ZERO_THRESHOLD } = require('./constants');
const { createLogger } = require('../logger');

const logger = createLogger('CorrelationMatrix');

/**
 * 平均の計算
 * @param {number[]} v - ベクトル
 * @returns {number} 平均値
 */
function mean(v) {
  validateVector(v);
  return v.reduce((sum, val) => sum + val, 0) / v.length;
}

/**
 * 標準偏差の計算
 * @param {number[]} v - ベクトル
 * @param {string} type - 'unbiased' (n-1) または 'sample' (n)
 * @returns {number} 標準偏差
 */
function std(v, type = 'unbiased') {
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

  const dof = type === 'unbiased' ? v.length - 1 : v.length;
  return Math.sqrt(sumSq / dof);
}

/**
 * 相関行列の計算
 * Correlation Matrix with configurable variance type
 *
 * @param {number[][]} data - 各行が観測、各列が変数の行列
 * @param {Object} options - オプション
 * @param {string} options.varianceType - 'unbiased' (n-1), 'sample' (n), または 'ewma'
 * @param {number} options.ewmaHalflife - EWMA の半減期（varianceType='ewma' の場合のみ必須）
 * @returns {number[][]} 相関行列
 */
function correlationMatrix(data, options = {}) {
  validateMatrix(data);

  const {
    varianceType = 'sample',
    ewmaHalflife = 30
  } = options;

  const n = data.length;
  const m = data[0].length;

  // サンプル数不足の場合は単位行列を返す（フォールバック）
  if (n < 2) {
    logger.warn(`Insufficient samples for correlation: n=${n}, returning identity matrix`);
    return Array.from({ length: m }, (_, i) =>
      Array.from({ length: m }, (_, j) => i === j ? 1 : 0)
    );
  }

  // EWMA の場合は専用関数を使用
  if (varianceType === 'ewma') {
    return computeEwmaCorrelation(data, ewmaHalflife);
  }

  // 自由度の設定
  const dof = varianceType === 'unbiased' ? n - 1 : n;

  // 平均の計算
  const means = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      means[j] += data[i][j];
    }
    means[j] /= n;
  }

  // 標準偏差の計算
  const stds = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = data[i][j] - means[j];
      sumSq += diff * diff;
    }
    stds[j] = Math.sqrt(sumSq / dof);

    // ゼロ分散の警告
    if (stds[j] < ZERO_THRESHOLD) {
      logger.warn(`Variable ${j} has near-zero standard deviation (std=${stds[j]})`);
    }
  }

  // 相関行列の計算
  const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let cov = 0;
      for (let k = 0; k < n; k++) {
        cov += (data[k][i] - means[i]) * (data[k][j] - means[j]);
      }
      cov /= dof;
      const denom = stds[i] * stds[j];
      corr[i][j] = denom > ZERO_THRESHOLD ? cov / denom : 0;
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

/**
 * EWMA 相関行列の計算（内部関数）
 * @private
 */
function computeEwmaCorrelation(data, halflife) {
  const L = data.length;
  const N = data[0].length;

  if (halflife <= 0) {
    throw new Error('halflife must be positive');
  }

  // スムージング係数 α = 1 - 0.5^(1/halflife)
  const alpha = 1.0 - 0.5 ** (1.0 / halflife);

  // 各時点の未正規化ウェイト w[i] = α * (1-α)^{L-1-i}
  const weights = new Array(L);
  let wSum = 0;
  for (let i = 0; i < L; i++) {
    weights[i] = alpha * Math.pow(1.0 - alpha, L - 1 - i);
    wSum += weights[i];
  }
  // 正規化
  for (let i = 0; i < L; i++) weights[i] /= wSum;

  // 加重平均
  const mu = new Array(N).fill(0);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < L; i++) {
      mu[j] += weights[i] * data[i][j];
    }
  }

  // 加重共分散行列
  const cov = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < L; i++) {
    for (let r = 0; r < N; r++) {
      const dr = data[i][r] - mu[r];
      for (let c = r; c < N; c++) {
        const dc = data[i][c] - mu[c];
        const val = weights[i] * dr * dc;
        cov[r][c] += val;
        if (r !== c) cov[c][r] += val;
      }
    }
  }

  // 相関行列に変換
  const corr = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const denom = Math.sqrt(Math.abs(cov[i][i]) * Math.abs(cov[j][j]));
      corr[i][j] = denom > 1e-10 ? cov[i][j] / denom : 0;
    }
    corr[i][i] = 1.0;  // 対角を厳密に 1
  }

  return corr;
}

/**
 * 標本相関行列（旧 API 互換用）
 * @deprecated correlationMatrix(data, { varianceType: 'sample' }) を使用
 */
function correlationMatrixSample(data) {
  return correlationMatrix(data, { varianceType: 'sample' });
}

/**
 * 不偏相関行列（旧 API 互換用）
 * @deprecated correlationMatrix(data, { varianceType: 'unbiased' }) を使用
 */
function correlationMatrixUnbiased(data) {
  return correlationMatrix(data, { varianceType: 'unbiased' });
}

/**
 * EWMA 相関行列（旧 API 互換用）
 * @deprecated correlationMatrix(data, { varianceType: 'ewma', ewmaHalflife: 30 }) を使用
 */
function ewmaCorrelationMatrix(data, halflife = 30) {
  return correlationMatrix(data, { varianceType: 'ewma', ewmaHalflife: halflife });
}

module.exports = {
  mean,
  std,
  correlationMatrix,
  correlationMatrixSample,
  correlationMatrixUnbiased,
  ewmaCorrelationMatrix
};
