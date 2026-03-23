'use strict';

const { validateMatrix } = require('./validate');
const { dotProduct } = require('./vector');
const { identity } = require('./util');
const { createLogger } = require('../logger');

const logger = createLogger('EigenDecomposition');

const DEFAULT_TOLERANCE = 1e-6;
const DEFAULT_MAX_ITER = 1000;
const ZERO_THRESHOLD = 1e-10;

function eigenDecomposition(matrix, k = 3, maxIter = DEFAULT_MAX_ITER, tolerance = DEFAULT_TOLERANCE) {
  validateMatrix(matrix);

  const n = matrix.length;
  if (n !== matrix[0].length) {
    throw new Error('Matrix must be square for eigen decomposition');
  }

  k = Math.min(k, n);

  const eigenvalues = [];
  const eigenvectors = [];
  let allConverged = true;

  let A = matrix.map(row => [...row]);

  for (let e = 0; e < k; e++) {
    // 初期ベクトル：ランダム化して収束性を向上
    let v = new Array(n).fill(0).map(() => Math.random() - 0.5);
    
    // 正規化
    let vNorm = 0;
    for (let i = 0; i < n; i++) {
      vNorm += v[i] * v[i];
    }
    vNorm = Math.sqrt(vNorm);
    
    if (vNorm < ZERO_THRESHOLD) {
      // ランダムベクトルがゼロの場合、標準基底を使用
      v = new Array(n).fill(0).map((_, i) => (i === e % n) ? 1 : 0);
      vNorm = 1;
    } else {
      v = v.map(x => x / vNorm);
    }

    let lambda = 0;
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      let vNew = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += A[i][j] * v[j];
        }
        vNew[i] = sum;
      }

      let newNorm = 0;
      for (let i = 0; i < n; i++) {
        newNorm += vNew[i] * vNew[i];
      }
      newNorm = Math.sqrt(newNorm);

      // ゼロ除算防止
      if (newNorm < ZERO_THRESHOLD) {
        logger.warn(`Eigenvalue ${e}: norm too small at iteration ${iter}`);
        break;
      }

      v = vNew.map(x => x / newNorm);

      const Av = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += A[i][j] * v[j];
        }
        Av[i] = sum;
      }

      const newLambda = dotProduct(v, Av);

      if (Math.abs(newLambda - lambda) < tolerance) {
        converged = true;
        lambda = newLambda;
        break;
      }

      lambda = newLambda;
    }

    if (!converged) {
      allConverged = false;
      logger.warn(`Eigenvalue ${e} did not converge after ${maxIter} iterations`);
    }

    eigenvalues.push(lambda);
    eigenvectors.push(v);

    // 行列の更新（Deflation）
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const update = lambda * v[i] * v[j];
        if (!Number.isFinite(update)) {
          throw new Error(`Numerical instability detected at eigenvalue ${e}`);
        }
        A[i][j] -= update;
      }
    }
  }

  // 固有ベクトルの正規化を再確認
  for (let i = 0; i < eigenvectors.length; i++) {
    const v = eigenvectors[i];
    let norm = 0;
    for (let j = 0; j < n; j++) {
      norm += v[j] * v[j];
    }
    norm = Math.sqrt(norm);
    if (norm > ZERO_THRESHOLD) {
      for (let j = 0; j < n; j++) {
        eigenvectors[i][j] /= norm;
      }
    }
  }

  return {
    eigenvalues,
    eigenvectors,
    converged: allConverged
  };
}

function symmetricEigenDecompositionJacobi(matrix, tol = 1e-12, maxSweeps = 150) {
  validateMatrix(matrix);
  const n = matrix.length;
  if (n !== matrix[0].length) {
    throw new Error('Matrix must be square for symmetric eigen decomposition');
  }

  const a = matrix.map(row => [...row]);
  const v = identity(n);

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let p = 0;
    let q = 1;
    let maxEl = 0;

    // 非対角要素の最大値を探索
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const el = Math.abs(a[i][j]);
        if (el > maxEl) {
          maxEl = el;
          p = i;
          q = j;
        }
      }
    }

    // 収束判定：非対角要素が十分に小さい
    if (maxEl < tol) {
      break;
    }

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];

    // 回転角度の計算
    // 数値的安定性の向上
    let c, s;
    if (Math.abs(app - aqq) < 1e-10) {
      // 対角要素が等しい場合、45 度回転
      c = s = 1 / Math.sqrt(2);
    } else {
      const theta = (app - aqq) / (2 * apq);
      const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      c = 1 / Math.sqrt(1 + t * t);
      s = t * c;
    }

    for (let j = 0; j < n; j++) {
      if (j !== p && j !== q) {
        const apj = a[p][j];
        const aqj = a[q][j];
        const newPj = c * apj - s * aqj;
        const newQj = s * apj + c * aqj;
        a[p][j] = a[j][p] = newPj;
        a[q][j] = a[j][q] = newQj;
      }
    }

    const appNew = c * c * app - 2 * s * c * apq + s * s * aqq;
    const aqqNew = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][p] = appNew;
    a[q][q] = aqqNew;
    a[p][q] = a[q][p] = 0;

    for (let i = 0; i < n; i++) {
      const vip = v[i][p];
      const viq = v[i][q];
      v[i][p] = c * vip - s * viq;
      v[i][q] = s * vip + c * viq;
    }
  }

  const eigenvalues = a.map((row, i) => row[i]);
  
  // 固有値の検証
  for (let i = 0; i < eigenvalues.length; i++) {
    if (!Number.isFinite(eigenvalues[i])) {
      logger.warn(`Invalid eigenvalue at index ${i}: ${eigenvalues[i]}`);
    }
  }
  
  return { eigenvalues, eigenvectorMatrix: v };
}

function eigenSymmetricTopK(matrix, k = 3, tol = 1e-12, maxSweeps = 80) {
  const { eigenvalues: lam, eigenvectorMatrix: V } = symmetricEigenDecompositionJacobi(
    matrix,
    tol,
    maxSweeps
  );
  const n = lam.length;
  k = Math.min(k, n);

  const idx = lam.map((val, i) => ({ val, i })).sort((a, b) => b.val - a.val);

  const eigenvalues = [];
  const eigenvectors = [];
  for (let e = 0; e < k; e++) {
    const col = idx[e].i;
    eigenvalues.push(lam[col]);
    const vec = new Array(n);
    for (let i = 0; i < n; i++) {
      vec[i] = V[i][col];
    }
    eigenvectors.push(vec);
  }

  return { eigenvalues, eigenvectors, converged: true };
}

module.exports = {
  eigenDecomposition,
  symmetricEigenDecompositionJacobi,
  eigenSymmetricTopK
};