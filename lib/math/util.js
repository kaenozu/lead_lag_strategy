'use strict';

const { validateMatrix } = require('./validate');
const { diag } = require('./matrix');

function trace(matrix) {
  validateMatrix(matrix);
  if (matrix.length !== matrix[0].length) {
    throw new Error('Matrix must be square to compute trace');
  }
  return diag(matrix).reduce((sum, val) => sum + val, 0);
}

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

function copyMatrix(matrix) {
  validateMatrix(matrix);
  return matrix.map(row => [...row]);
}

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
  trace,
  frobeniusNorm,
  copyMatrix,
  identity
};