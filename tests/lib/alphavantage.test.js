'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseTimeSeriesDaily,
  mergeBarsByDate,
  cacheCoversRange,
  selectBarsInRange,
  barDateRange,
  fetchUsDailyOhlcvCached,
  readUsage,
  utcDateString
} = require('../../lib/data/alphavantage');

describe('lib/data/alphavantage', () => {
  test('parseTimeSeriesDaily', () => {
    const { bars, error } = parseTimeSeriesDaily({
      'Time Series (Daily)': {
        '2024-01-05': {
          '1. open': '10',
          '2. high': '12',
          '3. low': '9',
          '4. close': '11',
          '5. volume': '1000'
        },
        '2024-01-04': {
          '1. open': '8',
          '2. high': '9',
          '3. low': '8',
          '4. close': '9',
          '5. volume': '500'
        }
      }
    });
    expect(error).toBeNull();
    expect(bars.map((b) => b.date)).toEqual(['2024-01-04', '2024-01-05']);
    expect(bars[1].close).toBe(11);
  });

  test('mergeBarsByDate は日付で後勝ち', () => {
    const a = [{ date: '2024-01-01', open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    const b = [{ date: '2024-01-01', open: 2, high: 2, low: 2, close: 2, volume: 2 }];
    expect(mergeBarsByDate(a, b)).toEqual(b);
  });

  test('cacheCoversRange', () => {
    const bars = [
      { date: '2020-01-02', close: 1 },
      { date: '2024-06-01', close: 2 }
    ];
    expect(cacheCoversRange(bars, '2020-01-02', '2024-06-01')).toBe(true);
    expect(cacheCoversRange(bars, '2019-01-01', '2024-06-01')).toBe(false);
    expect(cacheCoversRange(bars, '2020-01-02', '2025-01-01')).toBe(false);
  });

  test('selectBarsInRange', () => {
    const bars = [
      { date: '2024-01-01', close: 1 },
      { date: '2024-01-15', close: 2 },
      { date: '2024-02-01', close: 3 }
    ];
    expect(selectBarsInRange(bars, '2024-01-10', '2024-01-20').map((b) => b.date)).toEqual([
      '2024-01-15'
    ]);
  });

  test('barDateRange', () => {
    expect(barDateRange([])).toEqual({ min: null, max: null });
  });

  test('キャッシュが十分なら fetch を呼ばない', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-av-'));
    const cacheSub = path.join(dir, 'cache', 'alphavantage');
    fs.mkdirSync(cacheSub, { recursive: true });
    fs.writeFileSync(
      path.join(cacheSub, 'XLB.json'),
      JSON.stringify({
        symbol: 'XLB',
        bars: [
          { date: '2010-01-04', open: 1, high: 1, low: 1, close: 1, volume: 1 },
          { date: '2016-06-01', open: 1, high: 1, low: 1, close: 1, volume: 1 },
          { date: '2025-12-30', open: 2, high: 2, low: 2, close: 2, volume: 2 }
        ]
      }),
      'utf8'
    );

    const fetchMock = jest.fn();
    const prev = global.fetch;
    global.fetch = fetchMock;

    const appConfig = {
      data: {
        dataDir: dir,
        alphaVantageApiKey: 'testkey',
        alphaVantageDailyMaxCalls: 25
      },
      yahooFinance: { timeout: 5000 }
    };

    try {
      const r = await fetchUsDailyOhlcvCached('XLB', '2015-01-01', '2020-01-01', appConfig);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.error).toBeNull();
      const u = readUsage(appConfig);
      expect(u.count).toBe(0);
    } finally {
      global.fetch = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('日次上限超過でフォールバックフラグ', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-av2-'));
    const cacheSub = path.join(dir, 'cache', 'alphavantage');
    fs.mkdirSync(cacheSub, { recursive: true });
    fs.writeFileSync(
      path.join(cacheSub, '_daily_usage.json'),
      JSON.stringify({ date: utcDateString(), count: 25 }),
      'utf8'
    );

    const fetchMock = jest.fn();
    const prev = global.fetch;
    global.fetch = fetchMock;

    const appConfig = {
      data: {
        dataDir: dir,
        alphaVantageApiKey: 'testkey',
        alphaVantageDailyMaxCalls: 25
      },
      yahooFinance: { timeout: 5000 }
    };

    try {
      const r = await fetchUsDailyOhlcvCached('ZZZ', '2000-01-01', '2025-01-01', appConfig);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r.useYahooFallback).toBe(true);
      expect(r.data).toEqual([]);
    } finally {
      global.fetch = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
