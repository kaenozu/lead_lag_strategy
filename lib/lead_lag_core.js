/**
 * 部分空間正則化 PCA・リードラグシグナル（数値コア）
 * lib/pca.js への再エクスポート（下位互換性のため）
 */

'use strict';

const math = require('./math');
const pca = require('./pca');

let _eigenSeed = 42;

function setEigenSeed(seed) {
  _eigenSeed = (Math.floor(Number(seed)) || 42) >>> 0;
}

function eigenRand() {
  _eigenSeed = (_eigenSeed * 1664525 + 1013904223) >>> 0;
  return _eigenSeed / 4294967296;
}

function eigenDecomposition(matrix, k = 3) {
  const result = math.eigenSymmetricTopK(matrix, k);
  return {
    eigenvalues: result.eigenvalues,
    eigenvectors: result.eigenvectors
  };
}

class LeadLagSignalCompat extends pca.LeadLagSignal {
  compute(...args) {
    return this.computeSignal(...args);
  }
}

module.exports = {
  setEigenSeed,
  eigenRand,
  transpose: math.transpose,
  dotProduct: math.dotProduct,
  norm: math.norm,
  normalize: math.normalize,
  diag: math.diag,
  makeDiag: math.makeDiag,
  matmul: math.matmul,
  eigenDecomposition,
  correlationMatrix: math.correlationMatrixSample,
  SubspacePCA: pca.SubspaceRegularizedPCA,
  LeadLagSignal: LeadLagSignalCompat
};
