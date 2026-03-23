'use strict';

function parseOptionalInt(value, { min, max, name }, errors) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    errors.push(`${name} must be between ${min} and ${max}`);
    return undefined;
  }
  return parsed;
}

function parseOptionalFloat(value, { min, max, name, minExclusive = false }, errors) {
  const parsed = parseFloat(value);
  const isInvalid =
    Number.isNaN(parsed) ||
    parsed < min ||
    parsed > max ||
    (minExclusive && parsed === min);
  if (isInvalid) {
    const lowLabel = minExclusive ? `greater than ${min}` : `${min}`;
    errors.push(`${name} must be between ${lowLabel} and ${max}`);
    return undefined;
  }
  return parsed;
}

function validateBacktestParams(body = {}) {
  const errors = [];
  const params = {};

  if (body.windowLength !== undefined) {
    const val = parseOptionalInt(
      body.windowLength,
      { min: 10, max: 500, name: 'windowLength' },
      errors
    );
    if (val !== undefined) params.windowLength = val;
  }

  if (body.lambdaReg !== undefined) {
    const val = parseOptionalFloat(
      body.lambdaReg,
      { min: 0, max: 1, name: 'lambdaReg' },
      errors
    );
    if (val !== undefined) params.lambdaReg = val;
  }

  if (body.quantile !== undefined) {
    const val = parseOptionalFloat(
      body.quantile,
      { min: 0, max: 0.5, name: 'quantile', minExclusive: true },
      errors
    );
    if (val !== undefined) params.quantile = val;
  }

  if (body.nFactors !== undefined) {
    const val = parseOptionalInt(
      body.nFactors,
      { min: 1, max: 10, name: 'nFactors' },
      errors
    );
    if (val !== undefined) params.nFactors = val;
  }

  return { errors, params };
}

function validateConfigUpdateParams(body = {}) {
  const errors = [];
  const updates = {};

  if (body.windowLength !== undefined) {
    const val = parseOptionalInt(
      body.windowLength,
      { min: 10, max: 500, name: 'windowLength' },
      errors
    );
    if (val !== undefined) updates.windowLength = val;
  }

  if (body.lambdaReg !== undefined) {
    const val = parseOptionalFloat(
      body.lambdaReg,
      { min: 0, max: 1, name: 'lambdaReg' },
      errors
    );
    if (val !== undefined) updates.lambdaReg = val;
  }

  if (body.quantile !== undefined) {
    const val = parseOptionalFloat(
      body.quantile,
      { min: 0, max: 0.5, name: 'quantile', minExclusive: true },
      errors
    );
    if (val !== undefined) updates.quantile = val;
  }

  return { errors, updates };
}

module.exports = {
  validateBacktestParams,
  validateConfigUpdateParams
};

