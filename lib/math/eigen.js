'use strict';

const { validateMatrix } = require('./validate');
const { dotProduct } = require('./vector');
const { identity } = require('./util');
const { createLogger } = require('../logger');
const { DEFAULT_TOLERANCE, DEFAULT_MAX_ITER, ZERO_THRESHOLD } = require('./constants');

const logger = createLogger('EigenDecomposition');

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

  const A = matrix.map(row => [...row]);

  for (let e = 0; e < k; e++) {
    // 初期ベクトル：決定論的ランダム化（再現性確保）
    let v = new Array(n).fill(0).map((_, i) => 1 / (i + 1 + e * n) + 0.07 * (i % 7 - 3));
    
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
      const vNew = new Array(n).fill(0);
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
    if (Math.abs(app - aqq) < ZERO_THRESHOLD) {
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

function matvecSymmetric(A, v) {
  const n = v.length;
  const w = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * v[j];
    w[i] = s;
  }
  return w;
}

function argsortDesc(arr) {
  return arr
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.i);
}

function transposeMatrix(M) {
  const n = M.length;
  const m = M[0].length;
  const out = new Array(m).fill(0).map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) out[j][i] = M[i][j];
  }
  return out;
}

function normalizeVector(v) {
  const nrm = Math.sqrt(dotProduct(v, v));
  if (!(nrm > ZERO_THRESHOLD)) {
    throw new Error('Cannot normalize near-zero vector');
  }
  return v.map((x) => x / nrm);
}

function orthonormalizeColumns(V) {
  // V: n x k (columns in second dimension). Return n x k.
  const n = V.length;
  const k = V[0].length;
  const Q = new Array(n).fill(0).map(() => new Array(k).fill(0));
  for (let j = 0; j < k; j++) {
    let col = new Array(n);
    for (let i = 0; i < n; i++) col[i] = V[i][j];
    for (let jj = 0; jj < j; jj++) {
      const qprev = new Array(n);
      for (let i = 0; i < n; i++) qprev[i] = Q[i][jj];
      const d = dotProduct(col, qprev);
      for (let i = 0; i < n; i++) col[i] -= d * qprev[i];
    }
    col = normalizeVector(col);
    for (let i = 0; i < n; i++) Q[i][j] = col[i];
  }
  return Q;
}

function fallbackJacobiTopK(matrix, k) {
  // Full symmetric eigendecomposition via Jacobi, then take top-k.
  const { eigenvalues, eigenvectorMatrix } = symmetricEigenDecompositionJacobi(matrix);
  const order = argsortDesc(eigenvalues);
  const n = matrix.length;
  const kk = Math.min(k, n);

  // eigenvectorMatrix is n x n with eigenvectors as columns
  const V = new Array(n).fill(0).map(() => new Array(kk).fill(0));
  const vals = new Array(kk).fill(0);
  for (let j = 0; j < kk; j++) {
    const idx = order[j];
    vals[j] = eigenvalues[idx];
    for (let i = 0; i < n; i++) V[i][j] = eigenvectorMatrix[i][idx];
  }
  const VOrtho = orthonormalizeColumns(V);
  const eigenvectorsRowMajor = transposeMatrix(VOrtho); // k x n (matches existing return)
  return { eigenvalues: vals, eigenvectors: eigenvectorsRowMajor };
}

/**
 * 実対称行列の上位 k 固有ペア（デフレーション付きパワー法）。
 * 旧 Jacobi 実装は V^T A V と整合せず固有値が誤るケースがあったため置換。
 */
function eigenSymmetricTopK(matrix, k = 3, tol = ZERO_THRESHOLD, maxIter = 500) {
  validateMatrix(matrix);
  const n = matrix.length;
  if (n !== matrix[0].length) {
    throw new Error('Matrix must be square for symmetric eigen decomposition');
  }
  k = Math.min(k, n);

  const B = matrix.map(row => [...row]);
  const eigenvalues = [];
  const eigenvectors = [];
  let allConverged = true;
  let sawFailure = false;

  for (let e = 0; e < k; e++) {
    // 標準基底だけだとデフレ後に中位固有ベクトルへ即収束しうるため、成分に偏りを付ける
    let v = new Array(n);
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      v[i] = 1 / (i + 1) + 0.07 * e;
      sumSq += v[i] * v[i];
    }
    let vNorm = Math.sqrt(sumSq);
    v = v.map(x => x / vNorm);
    for (const u of eigenvectors) {
      const d = dotProduct(v, u);
      for (let i = 0; i < n; i++) v[i] -= d * u[i];
    }
    vNorm = Math.sqrt(dotProduct(v, v));
    if (vNorm < ZERO_THRESHOLD) {
      v = new Array(n).fill(0);
      v[(e + 1) % n] = 1;
      for (const u of eigenvectors) {
        const d = dotProduct(v, u);
        for (let i = 0; i < n; i++) v[i] -= d * u[i];
      }
      vNorm = Math.sqrt(dotProduct(v, v));
    }
    v = v.map(x => x / vNorm);

    let converged = false;
    for (let iter = 0; iter < maxIter; iter++) {
      const w = matvecSymmetric(B, v);
      const wNorm = Math.sqrt(dotProduct(w, w));
      if (wNorm < ZERO_THRESHOLD) {
        logger.warn(`eigenSymmetricTopK: zero norm at mode ${e}, iter ${iter}`);
        sawFailure = true;
        break;
      }
      const wn = w.map(x => x / wNorm);
      
      // 収束判定：v と wn のなす角のコサインが 1 に近づいたか確認
      // （符号反転を考慮して絶対値を取る）
      const cosTheta = Math.min(1, Math.abs(dotProduct(v, wn)));
      if (cosTheta > 1 - tol) {
        converged = true;
        v = wn;
        break;
      }
      
      v = wn;
    }

    if (!converged) {
      allConverged = false;
      logger.warn(`eigenSymmetricTopK: mode ${e} did not converge after ${maxIter} iterations`);
      sawFailure = true;
    }

    const lambda = dotProduct(v, matvecSymmetric(B, v));
    
    // Validate eigenvalue is finite
    if (!Number.isFinite(lambda)) {
      throw new Error(`Eigenvalue decomposition failed: mode ${e} produced non-finite eigenvalue: ${lambda}`);
    }
    
    eigenvalues.push(lambda);
    eigenvectors.push(v.map(x => x));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        B[i][j] -= lambda * v[i] * v[j];
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const avg = (B[i][j] + B[j][i]) / 2;
        B[i][j] = B[j][i] = avg;
      }
    }
  }

  if (!allConverged && sawFailure) {
    // Do not propagate unstable eigenvectors; compute a stable fallback.
    // Return converged=false so callers can decide to skip/guard, but provide usable top-k pairs.
    logger.warn('eigenSymmetricTopK: falling back to Jacobi eigen decomposition', { k, n });
    const fb = fallbackJacobiTopK(matrix, k);
    return { eigenvalues: fb.eigenvalues, eigenvectors: fb.eigenvectors, converged: false };
  }

  return { eigenvalues, eigenvectors, converged: allConverged };
}

module.exports = {
  eigenDecomposition,
  symmetricEigenDecompositionJacobi,
  eigenSymmetricTopK
};