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

/**
 * EWMA（指数加重移動平均）相関行列
 * Exponentially Weighted Moving Average Correlation Matrix
 *
 * 数式:
 *   α = 1 - 0.5^(1/halflife)          ← 半減期からスムージング係数に換算
 *   w[i] = α*(1-α)^{L-1-i}            ← i=0 が最古、i=L-1 が最新
 *   Σ_ewma = Σ_i w[i] * (r_i - μ_w)(r_i - μ_w)^T  / Σw  ← 加重共分散
 *   C[i,j] = Σ_ewma[i,j] / sqrt(Σ_ewma[i,i] * Σ_ewma[j,j])
 *
 * ベースライン (correlationMatrixSample) との違い:
 *   - 直近データに指数的に大きい重み → 市場レジーム変化に素早く追随
 *   - halflife=30: 今日の重みは 30 日前の 2 倍 (RiskMetrics 標準)
 *   - halflife=60: ほぼ等ウェイト (現行 L=60 窓に近い)
 *
 * @param {number[][]} data     L 行 × N 列のリターン行列 (各行が 1 時点)
 * @param {number}     halflife 半減期（日数）、デフォルト 30
 * @returns {number[][]} N × N の EWMA 相関行列
 */
function ewmaCorrelationMatrix(data, halflife = 30) {
  const { validateMatrix } = require('./validate');
  validateMatrix(data);

  const L = data.length;
  const N = data[0].length;

  if (L < 2) {
    throw new Error('Need at least 2 samples to compute EWMA correlation');
  }
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

module.exports = {
  mean,
  std,
  correlationMatrix,
  correlationMatrixSample,
  ewmaCorrelationMatrix
};