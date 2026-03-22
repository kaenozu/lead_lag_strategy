'use strict';

const { validateVector } = require('./validate');

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

function norm(v) {
  validateVector(v);
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

function normalize(v, tolerance = 1e-10) {
  validateVector(v);

  const n = norm(v);
  if (n < tolerance) {
    throw new Error('Cannot normalize zero vector');
  }

  return v.map(x => x / n);
}

function elementWiseMultiply(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  return a.map((val, i) => val * b[i]);
}

function scalarMultiply(v, scalar) {
  validateVector(v);
  const { validateNumber } = require('./validate');
  validateNumber(scalar, 'scalar');
  return v.map(x => x * scalar);
}

function vectorAdd(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  return a.map((val, i) => val + b[i]);
}

function vectorSubtract(a, b) {
  validateVector(a);
  validateVector(b);

  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  return a.map((val, i) => val - b[i]);
}

module.exports = {
  dotProduct,
  norm,
  normalize,
  elementWiseMultiply,
  scalarMultiply,
  vectorAdd,
  vectorSubtract
};