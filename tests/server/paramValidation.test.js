'use strict';

const {
  parseIntegerField,
  parseFloatField,
  applyFieldValidation,
  validateBacktestParams,
  validateConfigUpdateParams
} = require('../../src/server/modules/paramValidation');

describe('paramValidation', () => {
  test('parseIntegerField accepts trimmed integer strings', () => {
    const errors = [];
    const value = parseIntegerField(' 42 ', { min: 1, max: 100, name: 'windowLength' }, errors);

    expect(value).toBe(42);
    expect(errors).toEqual([]);
  });

  test('parseFloatField rejects values below an exclusive minimum', () => {
    const errors = [];
    const value = parseFloatField('0', { min: 0, max: 0.5, name: 'quantile', minExclusive: true }, errors);

    expect(value).toBeUndefined();
    expect(errors).toEqual(['quantile must be between greater than 0 and 0.5']);
  });

  test('applyFieldValidation only returns parsed fields that are present', () => {
    const errors = [];
    const values = applyFieldValidation({
      windowLength: '55',
      ignored: 'x'
    }, [
      { key: 'windowLength', parse: parseIntegerField, min: 10, max: 500, name: 'windowLength' }
    ], errors);

    expect(values).toEqual({ windowLength: 55 });
    expect(errors).toEqual([]);
  });

  test('validateBacktestParams parses all supported fields', () => {
    const result = validateBacktestParams({
      windowLength: '60',
      lambdaReg: '0.15',
      quantile: '0.2',
      nFactors: 4
    });

    expect(result.errors).toEqual([]);
    expect(result.params).toEqual({
      windowLength: 60,
      lambdaReg: 0.15,
      quantile: 0.2,
      nFactors: 4
    });
  });

  test('validateConfigUpdateParams shares the same numeric rules', () => {
    const result = validateConfigUpdateParams({
      windowLength: '12',
      lambdaReg: '0.3',
      quantile: '0.1'
    });

    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual({
      windowLength: 12,
      lambdaReg: 0.3,
      quantile: 0.1
    });
  });
});
