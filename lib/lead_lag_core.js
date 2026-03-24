/**
 * 部分空間正則化 PCA・リードラグシグナル（数値コア）
 * lib/pca.js への再エクスポート（下位互換性のため）
 *
 * @deprecated このモジュールは互換性のために残されています。
 *   - correlationMatrix    → lib/math の correlationMatrixSample を使用してください
 *   - eigenDecomposition   → lib/math の eigenSymmetricTopK を使用してください
 *   - LeadLagSignal        → lib/pca の LeadLagSignal + computeSignal() を使用してください
 *   - SubspacePCA          → lib/pca の SubspaceRegularizedPCA を使用してください
 */

'use strict';

const math = require('./math');
const pca = require('./pca');

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
