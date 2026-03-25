'use strict';

const { tickerToStooqSymbol, fetchStooqOhlcvWindow } = require('../../lib/data/stooq');

describe('lib/data/stooq', () => {
  test('tickerToStooqSymbol maps JP and US', () => {
    expect(tickerToStooqSymbol('1618.T')).toBe('1618.jp');
    expect(tickerToStooqSymbol('XLB')).toBe('xlb.us');
  });

  test('fetchStooqOhlcvWindow returns rows for known symbol (network)', async () => {
    const r = await fetchStooqOhlcvWindow('1618.T', '2024-01-01', '2024-01-15');
    expect(r.error).toBeNull();
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.sourcePath).toBe('jp:stooq');
    expect(r.data[0]).toMatchObject({
      date: expect.any(String),
      open: expect.any(Number),
      close: expect.any(Number)
    });
  }, 20000);
});
