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

function correlationMatrix(data) {
  const { validateMatrix } = require('./validate');
  validateMatrix(data);

  const n = data.length;
  const m = data[0].length;

  if (n < 2) {
    throw new Error('Need at least 2 samples to compute correlation');
  }

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
    stds[j] = Math.sqrt(sumSq / n);
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
    corr[i][i] = sumDiag / n;

    for (let j = i + 1; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += standardized[k][i] * standardized[k][j];
      }
      const corrIJ = sum / n;
      corr[i][j] = corrIJ;
      corr[j][i] = corrIJ;
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