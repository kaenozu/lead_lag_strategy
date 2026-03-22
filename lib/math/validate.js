'use strict';

function validateNumber(value, context = 'value') {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number in ${context}: ${value} (NaN or Infinity)`);
  }
}

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

function validateVector(vector) {
  if (!vector || vector.length === 0) {
    throw new Error('Invalid vector: vector is empty or null');
  }

  for (let i = 0; i < vector.length; i++) {
    validateNumber(vector[i], `vector[${i}]`);
  }
}

module.exports = {
  validateNumber,
  validateMatrix,
  validateVector
};