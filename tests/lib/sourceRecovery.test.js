'use strict';

const {
  isCsvDataMode,
  isAlreadyFullYahooPath,
  configForYahooDataRecovery
} = require('../../lib/data/sourceRecovery');

describe('lib/data/sourceRecovery', () => {
  const base = { data: { mode: 'jquants', usOhlcvProvider: 'alphavantage' } };

  test('isCsvDataMode', () => {
    expect(isCsvDataMode({ data: { mode: 'csv' } })).toBe(true);
    expect(isCsvDataMode(base)).toBe(false);
  });

  test('isAlreadyFullYahooPath', () => {
    expect(isAlreadyFullYahooPath({ data: { mode: 'yahoo', usOhlcvProvider: 'yahoo' } })).toBe(true);
    expect(isAlreadyFullYahooPath({ data: { mode: 'yahoo' } })).toBe(true);
    expect(isAlreadyFullYahooPath(base)).toBe(false);
  });

  test('configForYahooDataRecovery', () => {
    const r = configForYahooDataRecovery(base);
    expect(r.data.mode).toBe('yahoo');
    expect(r.data.usOhlcvProvider).toBe('yahoo');
    expect(base.data.mode).toBe('jquants');
  });
});
