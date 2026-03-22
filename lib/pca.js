/**
 * 部分空間正則化付き PCA
 * Subspace Regularized PCA with Enhanced Numerical Stability
 * 
 * @deprecated Use lib/pca/ instead
 */

'use strict';

const subspace = require('./pca/subspace');
const signal = require('./pca/signal');

module.exports = {
  ...subspace,
  ...signal
};
