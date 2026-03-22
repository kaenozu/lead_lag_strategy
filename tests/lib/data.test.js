/**
 * lib/data — computeReturns, CSV 取得、論文アライメント行列
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computeReturns,
  fetchTickerOhlcv,
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv,
  alignDates
} = require('../../lib/data');

describe('lib/data computeReturns', () => {
  test('cc: 隣接終値から 1 本のリターン', () => {
    const ohlc = [
      { date: '2024-01-01', open: 1, close: 100 },
      { date: '2024-01-02', open: 100, close: 110 }
    ];
    const r = computeReturns(ohlc, 'cc');
    expect(r).toHaveLength(1);
    expect(r[0].date).toBe('2024-01-02');
    expect(r[0].return).toBeCloseTo(0.1, 6);
  });

  test('cc: 不足データは空配列', () => {
    expect(computeReturns([], 'cc')).toEqual([]);
    expect(computeReturns([{ date: 'a', close: 1 }], 'cc')).toEqual([]);
    expect(computeReturns(null, 'cc')).toEqual([]);
  });

  test('oc: 日中リターン', () => {
    const ohlc = [{ date: '2024-01-02', open: 100, close: 105 }];
    const r = computeReturns(ohlc, 'oc');
    expect(r).toHaveLength(1);
    expect(r[0].return).toBeCloseTo(0.05, 6);
  });
});

describe('lib/data alignDates', () => {
  test('各 JP 日に直前の US 営業日を対応', () => {
    const us = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const jp = ['2024-01-02', '2024-01-04'];
    const a = alignDates(us, jp);
    expect(a).toEqual([
      { usDate: '2024-01-01', jpDate: '2024-01-02' },
      { usDate: '2024-01-03', jpDate: '2024-01-04' }
    ]);
  });
});

describe('lib/data fetchTickerOhlcv (csv)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-data-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('CSV を読み OHLCV を正規化', async () => {
    const csv =
      'Date,Open,High,Low,Close,Volume\n' +
      '2024-01-02,1,1,1,100,0\n' +
      '2024-01-03,100,100,100,110,0\n';
    fs.writeFileSync(path.join(tmpDir, 'TEST.csv'), csv);
    const appConfig = { data: { mode: 'csv', dataDir: tmpDir } };
    const { data, error } = await fetchTickerOhlcv('TEST', 10, appConfig);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data[1].close).toBe(110);
  });

  test('末尾 days 件にスライス', async () => {
    const lines = ['Date,Open,High,Low,Close,Volume'];
    for (let i = 0; i < 5; i++) {
      lines.push(`2024-01-0${i + 2},1,1,1,${100 + i},0`);
    }
    fs.writeFileSync(path.join(tmpDir, 'SL.csv'), lines.join('\n'));
    const appConfig = { data: { mode: 'csv', dataDir: tmpDir } };
    const { data, error } = await fetchTickerOhlcv('SL', 2, appConfig);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data[data.length - 1].close).toBe(104);
  });

  test('ファイルなしは error', async () => {
    const appConfig = { data: { mode: 'csv', dataDir: tmpDir } };
    const { data, error } = await fetchTickerOhlcv('NOSUCH', 10, appConfig);
    expect(data).toEqual([]);
    expect(error).toMatch(/not found|CSV not found/i);
  });
});

describe('lib/data fetchOhlcvForTickers', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-batch-'));
    const row =
      'Date,Open,High,Low,Close,Volume\n2024-01-02,1,1,1,100,0\n2024-01-03,100,100,100,102,0\n';
    fs.writeFileSync(path.join(tmpDir, 'A.csv'), row);
    fs.writeFileSync(path.join(tmpDir, 'B.csv'), row);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('複数銘柄を並列に読み込み', async () => {
    const appConfig = { data: { mode: 'csv', dataDir: tmpDir } };
    const { byTicker, errors } = await fetchOhlcvForTickers(['A', 'B'], 5, appConfig);
    expect(Object.keys(errors)).toHaveLength(0);
    expect(byTicker.A).toHaveLength(2);
    expect(byTicker.B).toHaveLength(2);
  });

  test('一部欠損は errors に記録', async () => {
    const appConfig = { data: { mode: 'csv', dataDir: tmpDir } };
    const { byTicker, errors } = await fetchOhlcvForTickers(['A', 'MISS'], 5, appConfig);
    expect(byTicker.A.length).toBe(2);
    expect(byTicker.MISS).toEqual([]);
    expect(errors.MISS).toBeDefined();
  });
});

describe('lib/data buildReturnMatricesFromOhlcv', () => {
  test('米日 OHLCV からアライメント済み系列', () => {
    const usData = {
      U1: [
        { date: '2024-01-01', open: 1, close: 100 },
        { date: '2024-01-02', open: 100, close: 102 }
      ]
    };
    const jpData = {
      J1: [
        { date: '2024-01-02', open: 100, close: 101 },
        { date: '2024-01-03', open: 101, close: 104 }
      ]
    };
    const { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
      usData,
      jpData,
      ['U1'],
      ['J1'],
      'cc'
    );
    expect(retUs.length).toBe(retJp.length);
    expect(retUs.length).toBe(retJpOc.length);
    expect(dates.length).toBeGreaterThan(0);
    expect(retUs[0].values).toHaveLength(1);
    expect(retJp[0].values).toHaveLength(1);
    expect(retJpOc[0].values).toHaveLength(1);
  });
});
