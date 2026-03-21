/**
 * 線形代数ユーティリティ関数
 * Linear Algebra Utilities
 */

'use strict';

/**
 * 行列の転置
 * @param {Array<Array<number>>} matrix - 入力行列
 * @returns {Array<Array<number>>} 転置行列
 */
function transpose(matrix) {
  if (!matrix || matrix.length === 0) {
    throw new Error('Invalid matrix: matrix is empty or null');
  }
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

/**
 * 行列の積
 * @param {Array<Array<number>>} A - 行列A
 * @param {Array<Array<number>>} B - 行列B
 * @returns {Array<Array<number>>} 行列の積 A×B
 */
function matmul(A, B) {
  if (!A || !B || A.length === 0 || B.length === 0) {
    throw new Error('Invalid input: matrices cannot be empty');
  }
  if (A[0].length !== B.length) {
    throw new Error(`Matrix dimensions mismatch: A is ${A.length}x${A[0].length}, B is ${B.length}x${B[0].length}`);
  }

  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;

  const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));

  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      for (let k = 0; k < colsA; k++) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }

  return result;
}

/**
 * ベクトルの内積
 * @param {Array<number>} a - ベクトルa
 * @param {Array<number>} b - ベクトルb
 * @returns {number} 内積
 */
function dotProduct(a, b) {
  if (!a || !b || a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: a=${a?.length}, b=${b?.length}`);
  }
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * ベクトルのノルム（L2ノルム）
 * @param {Array<number>} v - ベクトル
 * @returns {number} ノルム
 */
function norm(v) {
  if (!v || v.length === 0) {
    throw new Error('Invalid vector: vector is empty or null');
  }
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

/**
 * ベクトルの正規化
 * @param {Array<number>} v - ベクトル
 * @returns {Array<number>} 正規化されたベクトル
 */
function normalize(v) {
  const n = norm(v);
  if (n < 1e-10) {
    throw new Error('Cannot normalize zero vector');
  }
  return v.map(x => x / n);
}

/**
 * 行列の対角要素を取得
 * @param {Array<Array<number>>} matrix - 正方行列
 * @returns {Array<number>} 対角要素の配列
 */
function diag(matrix) {
  if (!matrix || matrix.length === 0) {
    throw new Error('Invalid matrix');
  }
  return matrix.map((row, i) => row[i]);
}

/**
 * 対角行列の作成
 * @param {Array<number>} v - 対角要素
 * @returns {Array<Array<number>>} 対角行列
 */
function makeDiag(v) {
  if (!v || v.length === 0) {
    throw new Error('Invalid input: vector cannot be empty');
  }
  const n = v.length;
  const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    result[i][i] = v[i];
  }
  return result;
}

/**
 * 行列の固有分解（べき乗法による近似）
 * @param {Array<Array<number>>} matrix - 対称行列
 * @param {number} k - 求める固有値・固有ベクトルの数
 * @param {number} maxIter - 最大反復回数（デフォルト: 1000）
 * @returns {Object} { eigenvalues: Array<number>, eigenvectors: Array<Array<number>> }
 */
function eigenDecomposition(matrix, k = 3, maxIter = 1000) {
  if (!matrix || matrix.length === 0) {
    throw new Error('Invalid matrix');
  }
  
  const n = matrix.length;
  k = Math.min(k, n);
  
  const eigenvalues = [];
  const eigenvectors = [];
  
  // 行列のコピーを作成
  let A = matrix.map(row => [...row]);
  
  for (let e = 0; e < k; e++) {
    // べき乗法
    let v = new Array(n).fill(0).map(() => Math.random());
    try {
      v = normalize(v);
    } catch (err) {
      // ランダムベクトルがゼロになることはないが、念のため
      v = new Array(n).fill(0).map((_, i) => i === 0 ? 1 : 0);
    }
    
    for (let iter = 0; iter < maxIter; iter++) {
      let vNew = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          vNew[i] += A[i][j] * v[j];
        }
      }
      
      const newNorm = norm(vNew);
      if (newNorm < 1e-10) break;
      
      v = vNew.map(x => x / newNorm);
    }
    
    // 固有値の計算
    const Av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        Av[i] += A[i][j] * v[j];
      }
    }
    const lambda = dotProduct(v, Av);
    
    eigenvalues.push(lambda);
    eigenvectors.push(v);
    
    // 行列の deflate
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i][j] -= lambda * v[i] * v[j];
      }
    }
  }
  
  return { eigenvalues, eigenvectors };
}

/**
 * 相関行列の計算
 * @param {Array<Array<number>>} data - データ行列（行: サンプル、列: 変数）
 * @returns {Array<Array<number>>} 相関行列
 */
function correlationMatrix(data) {
  if (!data || data.length === 0 || !data[0]) {
    throw new Error('Invalid data: data cannot be empty');
  }
  
  const n = data.length;
  const m = data[0].length;
  
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
  
  // 標準化
  const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      standardized[i][j] = stds[j] > 1e-10 ? (data[i][j] - means[j]) / stds[j] : 0;
    }
  }
  
  // 相関行列
  const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += standardized[k][i] * standardized[k][j];
      }
      corr[i][j] = sum / n;
    }
  }
  
  return corr;
}

/**
 * ベクトルの要素ごとの積（Hadamard積）
 * @param {Array<number>} a - ベクトルa
 * @param {Array<number>} b - ベクトルb
 * @returns {Array<number>} 要素ごとの積
 */
function elementWiseMultiply(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  return a.map((val, i) => val * b[i]);
}

/**
 * ベクトルのスカラー倍
 * @param {Array<number>} v - ベクトル
 * @param {number} scalar - スカラー
 * @returns {Array<number>} スカラー倍されたベクトル
 */
function scalarMultiply(v, scalar) {
  return v.map(x => x * scalar);
}

/**
 * ベクトルの加算
 * @param {Array<number>} a - ベクトルa
 * @param {Array<number>} b - ベクトルb
 * @returns {Array<number>} 加算結果
 */
function vectorAdd(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  return a.map((val, i) => val + b[i]);
}

/**
 * ベクトルの減算
 * @param {Array<number>} a - ベクトルa
 * @param {Array<number>} b - ベクトルb
 * @returns {Array<number>} 減算結果
 */
function vectorSubtract(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  return a.map((val, i) => val - b[i]);
}

/**
 * ベクトルの平均
 * @param {Array<number>} v - ベクトル
 * @returns {number} 平均値
 */
function mean(v) {
  if (!v || v.length === 0) {
    throw new Error('Invalid vector');
  }
  return v.reduce((sum, val) => sum + val, 0) / v.length;
}

/**
 * ベクトルの標準偏差
 * @param {Array<number>} v - ベクトル
 * @returns {number} 標準偏差
 */
function std(v) {
  if (!v || v.length < 2) {
    throw new Error('Invalid vector: need at least 2 elements');
  }
  const m = mean(v);
  const variance = v.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / (v.length - 1);
  return Math.sqrt(variance);
}

module.exports = {
  transpose,
  matmul,
  dotProduct,
  norm,
  normalize,
  diag,
  makeDiag,
  eigenDecomposition,
  correlationMatrix,
  elementWiseMultiply,
  scalarMultiply,
  vectorAdd,
  vectorSubtract,
  mean,
  std
};
