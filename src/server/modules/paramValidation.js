'use strict';

function parseIntegerField(value, { min, max, name }, errors) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    errors.push(`${name} must be a number`);
    return undefined;
  }

  const strVal = String(value).trim();
  if (!/^-?\d+$/.test(strVal)) {
    errors.push(`${name} must be an integer`);
    return undefined;
  }

  const parsed = Number.parseInt(strVal, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    errors.push(`${name} must be between ${min} and ${max}`);
    return undefined;
  }

  return parsed;
}

function parseFloatField(value, { min, max, name, minExclusive = false }, errors) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    errors.push(`${name} must be a number`);
    return undefined;
  }

  const parsed = Number.parseFloat(value);
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

function applyFieldValidation(body, rules, errors) {
  const values = {};
  for (const rule of rules) {
    if (body[rule.key] === undefined) continue;
    const parsed = rule.parse(body[rule.key], rule, errors);
    if (parsed !== undefined) values[rule.key] = parsed;
  }
  return values;
}

const BACKTEST_FIELD_RULES = [
  { key: 'windowLength', parse: parseIntegerField, min: 10, max: 500, name: 'windowLength' },
  { key: 'lambdaReg', parse: parseFloatField, min: 0, max: 1, name: 'lambdaReg' },
  { key: 'quantile', parse: parseFloatField, min: 0, max: 0.5, name: 'quantile', minExclusive: true },
  { key: 'nFactors', parse: parseIntegerField, min: 1, max: 10, name: 'nFactors' }
];

const CONFIG_UPDATE_FIELD_RULES = BACKTEST_FIELD_RULES.slice(0, 3);

function validateBacktestParams(body = {}) {
  const errors = [];
  const params = applyFieldValidation(body, BACKTEST_FIELD_RULES, errors);

  return { errors, params };
}

function validateConfigUpdateParams(body = {}) {
  const errors = [];
  const updates = applyFieldValidation(body, CONFIG_UPDATE_FIELD_RULES, errors);

  return { errors, updates };
}

module.exports = {
  parseIntegerField,
  parseFloatField,
  applyFieldValidation,
  validateBacktestParams,
  validateConfigUpdateParams
};
