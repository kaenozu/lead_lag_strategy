'use strict';

const { validateMatrix } = require('./validate');

function transpose(matrix) {
  validateMatrix(matrix);
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

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

function diag(matrix) {
  validateMatrix(matrix);
  return matrix.map((row, i) => row[i]);
}

function makeDiag(v) {
  const { validateVector } = require('./validate');
  validateVector(v);

  const n = v.length;
  const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    result[i][i] = v[i];
  }
  return result;
}

module.exports = {
  transpose,
  matmul,
  diag,
  makeDiag
};