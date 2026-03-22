'use strict';

const { validateMatrix } = require('./validate');
const { dotProduct } = require('./vector');
const { identity } = require('./util');

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
    let v = new Array(n).fill(0).map((_, i) => A[i][e] || 0);

    let vNorm = 0;
    for (let i = 0; i < n; i++) {
      vNorm += v[i] * v[i];
    }

    if (vNorm < ZERO_THRESHOLD) {
      v = new Array(n).fill(0).map((_, i) => (i === e % n) ? 1 : 0);
      vNorm = 1;
    }

    v = v.map(x => x / Math.sqrt(vNorm));

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

      if (newNorm < ZERO_THRESHOLD) {
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
    }

    eigenvalues.push(lambda);
    eigenvectors.push(v);

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

  return {
    eigenvalues,
    eigenvectors,
    converged: allConverged
  };
}

function symmetricEigenDecompositionJacobi(matrix, tol = 1e-12, maxSweeps = 80) {
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
    let maxEl = Math.abs(a[0][1]);

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

    if (maxEl < tol) {
      break;
    }

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, app - aqq);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

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