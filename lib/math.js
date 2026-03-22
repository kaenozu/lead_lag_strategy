/**
 * 線形代数ユーティリティ関数
 * Linear Algebra Utilities with Enhanced Numerical Stability
 */

'use strict';

// 定数
const DEFAULT_TOLERANCE = 1e-6;
const DEFAULT_MAX_ITER = 1000;
const ZERO_THRESHOLD = 1e-10;

/**
 * 数値の妥当性をチェック（NaN/Infinity を検出）
 * @param {number} value - 検査する値
 * @param {string} context - コンテキスト情報
 * @throws {Error} 無効な値の場合
 */
function validateNumber(value, context = 'value') {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number in ${context}: ${value} (NaN or Infinity)`);
  }
}

/**
 * 行列の妥当性をチェック
 * @param {Array<Array<number>>} matrix - 検査する行列
 * @throws {Error} 無効な行列の場合
 */
function validateMatrix(matrix) {
  if (!matrix || matrix.length === 0) {
    throw new Error('Invalid matrix: matrix is empty or null');
  }

  const cols = matrix[0].length;
  if (cols === 0) {
    throw new Error('Invalid matrix: has no columns');
  }

  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].length !== cols) {
      throw new Error(`Invalid matrix: row ${i} has inconsistent length`);
    }
    for (let j = 0; j < cols; j++) {
      validateNumber(matrix[i][j], `matrix[${i}][${j}]`);
    }
  }
}

/**
 * ベクトルの妥当性をチェック
 * @param {Array<number>} vector - 検査するベクトル
 * @throws {Error} 無効なベクトルの場合
 */
function validateVector(vector) {
  if (!vector || vector.length === 0) {
    throw new Error('Invalid vector: vector is empty or null');
  }

  for (let i = 0; i < vector.length; i++) {
    validateNumber(vector[i], `vector[${i}]`);
  }
}

/**
 * 行列の転置
 */
function transpose(matrix) {
  validateMatrix(matrix);
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

/**
 * 行列の積（最適化：ローカル変数活用）
 */
function matmul(A, B) {
  validateMatrix(A);
  validateMatrix(B);

  if (A[0].length !== B.length) {
    throw new Error(
      `Matrix dimensions mismatch: A is ${A.length}x${A[0].length}, B is ${B.length}x${B[0].length}`
    );
  }

  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;

  const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));

  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += A[i][k] * B[k][j];
      }
      result[i][j] = sum;
    }
  }

  return result;
}

/**
 * ベクトルの内積
 */
function dotProduct(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: a=${a.length}, b=${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * ベクトルのノルム（L2 ノルム）
 */
function norm(v) {
  validateVector(v);
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

/**
 * ベクトルの正規化
 * @param {Array<number>} v - ベクトル
 * @param {number} tolerance - ゼロ判定閾値
 * @returns {Array<number>} 正規化されたベクトル
 * @throws {Error} ゼロベクトルの場合
 */
function normalize(v, tolerance = ZERO_THRESHOLD) {
  validateVector(v);

  const n = norm(v);
  if (n < tolerance) {
    throw new Error('Cannot normalize zero vector');
  }

  return v.map(x => x / n);
}

/**
 * 行列の対角要素を取得
 */
function diag(matrix) {
  validateMatrix(matrix);
  return matrix.map((row, i) => row[i]);
}

/**
 * 対角行列の作成
 */
function makeDiag(v) {
  validateVector(v);

  const n = v.length;
  const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    result[i][i] = v[i];
  }
  return result;
}

/**
 * 行列の固有分解（べき乗法・改良版）
 *
 * @deprecated 対称行列の本番用途は {@link eigenSymmetricTopK}（ヤコビ法）を使用してください。
 * 本関数は後方互換・テスト用に残しています。
 *
 * 改善点：
 * 1. 収束判定の追加（tolerance: 1e-6）
 * 2. ゼロ除算・特異行列のチェック
 * 3. NaN/Infinity の検出
 * 4. 決定論的な初期化（ランダム性排除）
 *
 * @param {Array<Array<number>>} matrix - 対称行列
 * @param {number} k - 求める固有値・固有ベクトルの数
 * @param {number} maxIter - 最大反復回数（デフォルト：1000）
 * @param {number} tolerance - 収束判定閾値（デフォルト：1e-6）
 * @returns {Object} { eigenvalues: Array<number>, eigenvectors: Array<Array<number>>, converged: boolean }
 */
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

  // 行列のコピーを作成（元データを保持）
  let A = matrix.map(row => [...row]);

  for (let e = 0; e < k; e++) {
    // べき乗法：決定論的な初期化（e 番目の列を使用）
    let v = new Array(n).fill(0).map((_, i) => A[i][e] || 0);

    // ゼロベクトルの場合は単位ベクトルを使用
    let vNorm = 0;
    for (let i = 0; i < n; i++) {
      vNorm += v[i] * v[i];
    }

    if (vNorm < ZERO_THRESHOLD) {
      v = new Array(n).fill(0).map((_, i) => (i === e % n) ? 1 : 0);
      vNorm = 1;
    }

    // 正規化
    v = v.map(x => x / Math.sqrt(vNorm));

    let lambda = 0;
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      // 行列ベクトル積
      let vNew = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += A[i][j] * v[j];
        }
        vNew[i] = sum;
      }

      // 新しいノルム
      let newNorm = 0;
      for (let i = 0; i < n; i++) {
        newNorm += vNew[i] * vNew[i];
      }
      newNorm = Math.sqrt(newNorm);

      // ゼロ除算チェック
      if (newNorm < ZERO_THRESHOLD) {
        break;
      }

      // 正規化
      v = vNew.map(x => x / newNorm);

      // レイリー商による固有値の推定
      const Av = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += A[i][j] * v[j];
        }
        Av[i] = sum;
      }

      const newLambda = dotProduct(v, Av);

      // 収束判定
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

    // 行列の deflate（特異値チェック付き）
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const update = lambda * v[i] * v[j];
        // NaN/Infinity チェック
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

/**
 * 相関行列の計算（最適化：対称性を利用）
 * 改善点：
 * 1. 対称性を利用（半分のみ計算）
 * 2. 数値的安定性の向上
 * 3. ゼロ標準偏差の処理
 *
 * @param {Array<Array<number>>} data - データ行列（行：サンプル、列：変数）
 * @returns {Array<Array<number>>} 相関行列
 */
function correlationMatrix(data) {
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

  // 標準偏差の計算
  const stds = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = data[i][j] - means[j];
      sumSq += diff * diff;
    }
    stds[j] = Math.sqrt(sumSq / n);
  }

  // 標準化と相関行列の計算（一度に処理）
  const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      standardized[i][j] = stds[j] > ZERO_THRESHOLD
        ? (data[i][j] - means[j]) / stds[j]
        : 0;
    }
  }

  // 相関行列（対称性を利用：半分のみ計算）
  const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));

  for (let i = 0; i < m; i++) {
    // 対角要素
    let sumDiag = 0;
    for (let k = 0; k < n; k++) {
      sumDiag += standardized[k][i] * standardized[k][i];
    }
    corr[i][i] = sumDiag / n;

    // 非対角要素（上三角のみ計算）
    for (let j = i + 1; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += standardized[k][i] * standardized[k][j];
      }
      const corrIJ = sum / n;
      corr[i][j] = corrIJ;
      corr[j][i] = corrIJ; // 対称性
    }
  }

  return corr;
}

/**
 * numpy np.corrcoef(returns.T) と同一定義の標本相関行列（ddof=1 の共分散／標準偏差）
 * 行＝観測、列＝資産
 * @param {Array<Array<number>>} data
 * @returns {Array<Array<number>>}
 */
function correlationMatrixSample(data) {
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
      corr[i][j] = denom > ZERO_THRESHOLD ? cov / denom : 0;
    }
  }

  return corr;
}

/**
 * 実対称行列のヤコビ法による全固有分解（eigh 相当）
 * @param {Array<Array<number>>} matrix - 対称正方行列（上書きされないよう内部でコピー）
 * @param {number} tol - 非対角最大要素の収束閾値
 * @param {number} maxSweeps - 最大スイープ数
 * @returns {{ eigenvalues: number[], eigenvectorMatrix: number[][] }} eigenvectorMatrix[i][j] = j 番目固有ベクトルの i 成分
 */
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

/**
 * 対称行列の上位 k 固有値・固有ベクトル（降順、列＝固有ベクトルと同じく eigenvectorMatrix の列から取得）
 * @returns {{ eigenvalues: number[], eigenvectors: number[][], converged: boolean }}
 * eigenvectors[e] は長さ n の e 番目の固有ベクトル（べき乗法 API と互換）
 */
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

/**
 * ベクトルの要素ごとの積（Hadamard 積）
 */
function elementWiseMultiply(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  return a.map((val, i) => val * b[i]);
}

/**
 * ベクトルのスカラー倍
 */
function scalarMultiply(v, scalar) {
  validateVector(v);
  validateNumber(scalar, 'scalar');
  return v.map(x => x * scalar);
}

/**
 * ベクトルの加算
 */
function vectorAdd(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  return a.map((val, i) => val + b[i]);
}

/**
 * ベクトルの減算
 */
function vectorSubtract(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  return a.map((val, i) => val - b[i]);
}

/**
 * ベクトルの平均
 */
function mean(v) {
  validateVector(v);
  return v.reduce((sum, val) => sum + val, 0) / v.length;
}

/**
 * ベクトルの標準偏差（不偏推定量）
 */
function std(v) {
  validateVector(v);

  if (v.length < 2) {
    throw new Error('Need at least 2 elements to compute standard deviation');
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
 * 行列のトレース（対角要素の和）
 * @param {Array<Array<number>>} matrix - 正方行列
 * @returns {number} トレース
 */
function trace(matrix) {
  validateMatrix(matrix);
  if (matrix.length !== matrix[0].length) {
    throw new Error('Matrix must be square to compute trace');
  }
  return diag(matrix).reduce((sum, val) => sum + val, 0);
}

/**
 * 行列のフロベニウスノルム
 * @param {Array<Array<number>>} matrix - 行列
 * @returns {number} フロベニウスノルム
 */
function frobeniusNorm(matrix) {
  validateMatrix(matrix);
  let sumSq = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      sumSq += matrix[i][j] * matrix[i][j];
    }
  }
  return Math.sqrt(sumSq);
}

/**
 * 行列のコピー（ディープコピー）
 * @param {Array<Array<number>>} matrix - 行列
 * @returns {Array<Array<number>>} コピー
 */
function copyMatrix(matrix) {
  validateMatrix(matrix);
  return matrix.map(row => [...row]);
}

/**
 * 単位行列の作成
 * @param {number} n - サイズ
 * @returns {Array<Array<number>>} 単位行列
 */
function identity(n) {
  if (n <= 0) {
    throw new Error('Matrix size must be positive');
  }

  const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    result[i][i] = 1;
  }
  return result;
}

module.exports = {
  // 定数
  DEFAULT_TOLERANCE,
  DEFAULT_MAX_ITER,
  ZERO_THRESHOLD,

  // 検証関数
  validateNumber,
  validateMatrix,
  validateVector,

  // 基本演算
  transpose,
  matmul,
  dotProduct,
  norm,
  normalize,
  diag,
  makeDiag,

  // 固有値分解
  eigenDecomposition,
  symmetricEigenDecompositionJacobi,
  eigenSymmetricTopK,

  // 統計
  correlationMatrix,
  correlationMatrixSample,
  mean,
  std,

  // ベクトル演算
  elementWiseMultiply,
  scalarMultiply,
  vectorAdd,
  vectorSubtract,

  // 行列演算
  trace,
  frobeniusNorm,
  copyMatrix,
  identity
};
