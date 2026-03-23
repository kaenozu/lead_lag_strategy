'use strict';

const {
  mergeOhlcvByDate,
  resolveJQuantsCode,
  mapJQuantsDailyQuoteRow,
  chunkDateRange
} = require('../../lib/data/jquants');
const { config } = require('../../lib/config');

describe('lib/data/jquants', () => {
  test('mergeOhlcvByDate は日付でマージし後勝ち', () => {
    const a = [
      { date: '2024-01-01', open: 1, high: 1, low: 1, close: 100, volume: 1 },
      { date: '2024-01-02', open: 1, high: 1, low: 1, close: 101, volume: 1 }
    ];
    const b = [
      { date: '2024-01-02', open: 2, high: 2, low: 2, close: 200, volume: 2 },
      { date: '2024-01-03', open: 3, high: 3, low: 3, close: 300, volume: 3 }
    ];
    const m = mergeOhlcvByDate(a, b);
    expect(m.map((r) => r.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(m.find((r) => r.date === '2024-01-02').close).toBe(200);
  });

  test('resolveJQuantsCode は JQUANTS_SYMBOL_MAP_JSON を優先', () => {
    const cfg = {
      data: {
        jquantsCodes: { '1617.T': '99999' }
      }
    };
    expect(resolveJQuantsCode('1617.T', cfg)).toBe('99999');
    expect(resolveJQuantsCode('XLB', cfg)).toBe(null);
  });

  test('resolveJQuantsCode は 4桁.T を推測', () => {
    expect(resolveJQuantsCode('1617.T', config)).toBe('16170');
  });

  test('mapJQuantsDailyQuoteRow は Close 必須、Open 欠損は Close で埋める', () => {
    const row = mapJQuantsDailyQuoteRow({
      Date: '2023-03-24',
      Open: null,
      High: 2069,
      Low: 2035,
      Close: 2045,
      Volume: 100
    });
    expect(row).toEqual({
      date: '2023-03-24',
      open: 2045,
      high: 2069,
      low: 2035,
      close: 2045,
      volume: 100
    });
    expect(mapJQuantsDailyQuoteRow({ Date: '2023-03-24', Close: null })).toBe(null);
  });

  test('chunkDateRange は暦日チャンクに分割', () => {
    const parts = [...chunkDateRange('2024-01-01', '2024-01-05', 2)];
    expect(parts).toEqual([
      { from: '2024-01-01', to: '2024-01-02' },
      { from: '2024-01-03', to: '2024-01-04' },
      { from: '2024-01-05', to: '2024-01-05' }
    ]);
  });
});
