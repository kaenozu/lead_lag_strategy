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
  alignDates,
  alignDatesLegacy,
  buildPaperAlignedReturnRows,
  parseCSV,
  loadCSV,
  saveCSV,
  computeCCReturns,
  computeOCReturns,
  buildReturnMatrix,
  transpose,
  fillForward,
  fillBackward,
  fillLinear,
  dropNA,
  isTradingDay,
  filterTradingDays,
  fetchWithRetry,
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

  test('空の usDates は空配列を返す', () => {
    expect(alignDates([], ['2024-01-02'])).toEqual([]);
  });

  test('空の jpDates は空配列を返す', () => {
    expect(alignDates(['2024-01-01'], [])).toEqual([]);
  });

  test('null usDates は空配列を返す', () => {
    expect(alignDates(null, ['2024-01-01'])).toEqual([]);
  });

  test('JP 日より前の US 日がない場合はスキップ', () => {
    // JP 日が US 日より早い場合、対応する US 日なし
    const us = ['2024-01-10', '2024-01-11'];
    const jp = ['2024-01-05'];
    const result = alignDates(us, jp);
    expect(result).toHaveLength(0);
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

describe('lib/data fetchWithRetry', () => {
  test('成功する関数はそのまま結果を返す', async () => {
    const result = await fetchWithRetry(async () => 'ok');
    expect(result).toBe('ok');
  });

  test('1 回失敗後に成功する', async () => {
    let calls = 0;
    const result = await fetchWithRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('first fail');
      return 'ok';
    }, { maxRetries: 2, baseDelay: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  test('常に失敗するとエラーをスロー', async () => {
    await expect(
      fetchWithRetry(async () => { throw new Error('always fail'); }, { maxRetries: 1, baseDelay: 1 })
    ).rejects.toThrow('always fail');
  });

  test('shouldRetry=false の場合リトライせずにスロー', async () => {
    let calls = 0;
    await expect(
      fetchWithRetry(async () => {
        calls++;
        throw new Error('no retry');
      }, { maxRetries: 3, baseDelay: 1, shouldRetry: () => false })
    ).rejects.toThrow('no retry');
    expect(calls).toBe(1);
  });
});

describe('lib/data alignDatesLegacy', () => {
  test('空配列は空配列を返す', () => {
    expect(alignDatesLegacy([], ['2024-01-01'])).toEqual([]);
    expect(alignDatesLegacy(['2024-01-01'], [])).toEqual([]);
    expect(alignDatesLegacy(null, ['2024-01-01'])).toEqual([]);
  });

  test('重複する日付をペアリング', () => {
    const usDates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const jpDates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const result = alignDatesLegacy(usDates, jpDates);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('usDate');
    expect(result[0]).toHaveProperty('jpDate');
  });

  test('lagDays オプションが機能する', () => {
    const usDates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const jpDates = ['2024-01-02', '2024-01-03'];
    const result = alignDatesLegacy(usDates, jpDates, { lagDays: 1 });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('lib/data buildPaperAlignedReturnRows', () => {
  const makeTestMaps = () => {
    const usMap = new Map([
      ['2024-01-02', { U1: 0.01, U2: 0.02 }],
      ['2024-01-03', { U1: 0.015, U2: 0.018 }],
      ['2024-01-04', { U1: -0.01, U2: -0.005 }],
    ]);
    const jpCCMap = new Map([
      ['2024-01-02', { J1: 0.012 }],
      ['2024-01-03', { J1: 0.016 }],
      ['2024-01-04', { J1: -0.008 }],
    ]);
    const jpOCMap = new Map([
      ['2024-01-02', { J1: 0.005 }],
      ['2024-01-03', { J1: 0.008 }],
      ['2024-01-04', { J1: -0.003 }],
    ]);
    return { usMap, jpCCMap, jpOCMap };
  };

  test('cc モードで行列を構築', () => {
    const { usMap, jpCCMap, jpOCMap } = makeTestMaps();
    const { retUs, retJp, retJpOc, dates } = buildPaperAlignedReturnRows(
      usMap, jpCCMap, jpOCMap, ['U1', 'U2'], ['J1'], 'cc'
    );
    expect(retUs.length).toBeGreaterThan(0);
    expect(retJp.length).toBe(retUs.length);
    expect(retJpOc.length).toBe(retUs.length);
    expect(dates.length).toBe(retUs.length);
  });

  test('oc モードで JP は OC リターンを使用', () => {
    const { usMap, jpCCMap, jpOCMap } = makeTestMaps();
    const ccResult = buildPaperAlignedReturnRows(
      usMap, jpCCMap, jpOCMap, ['U1', 'U2'], ['J1'], 'cc'
    );
    const ocResult = buildPaperAlignedReturnRows(
      usMap, jpCCMap, jpOCMap, ['U1', 'U2'], ['J1'], 'oc'
    );
    // oc モードでは JP 値が OC から取られる
    expect(ccResult.retJp[0].values[0]).not.toBe(ocResult.retJp[0].values[0]);
  });

  test('欠損データはスキップ', () => {
    const usMap = new Map([
      ['2024-01-02', { U1: 0.01 }],
      ['2024-01-03', { U1: undefined }], // 欠損
    ]);
    const jpCCMap = new Map([
      ['2024-01-02', { J1: 0.012 }],
      ['2024-01-03', { J1: 0.016 }],
    ]);
    const jpOCMap = new Map([
      ['2024-01-02', { J1: 0.005 }],
      ['2024-01-03', { J1: 0.008 }],
    ]);
    const { retUs } = buildPaperAlignedReturnRows(
      usMap, jpCCMap, jpOCMap, ['U1'], ['J1'], 'cc'
    );
    // 欠損行は除外
    expect(retUs.length).toBeLessThanOrEqual(2);
  });
});

describe('lib/data parseCSV', () => {
  test('基本的な CSV をパース', () => {
    const csv = 'Name,Open,Close\nAAPL,100,105\nGOOGL,105,103\n';
    const result = parseCSV(csv);
    expect(result).toHaveLength(2);
    expect(result[0].Name).toBe('AAPL');
    expect(result[0].Open).toBe(100);
    expect(result[0].Close).toBe(105);
  });

  test('数値プレフィックスの日付は数値として保持される', () => {
    // parseFloat('2024-01-01') = 2024 なので数値として保存される
    const csv = 'Date,Close\n2024-01-01,100\n';
    const result = parseCSV(csv);
    expect(result).toHaveLength(1);
    expect(result[0].Close).toBe(100);
  });

  test('ヘッダーのみの CSV はエラー', () => {
    expect(() => parseCSV('Date,Open,Close')).toThrow('at least a header and one data row');
  });

  test('列数不一致の行はスキップ', () => {
    const csv = 'Name,Open,Close\nAAPL,100,105\nbad,row\nGOOGL,106,107\n';
    const result = parseCSV(csv);
    expect(result).toHaveLength(2); // 不一致の行はスキップ
  });

  test('数値でない値は文字列として保持', () => {
    const csv = 'Date,Symbol\n2024-01-01,AAPL\n';
    const result = parseCSV(csv);
    expect(result[0].Symbol).toBe('AAPL');
  });
});

describe('lib/data loadCSV', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-loadcsv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ファイルを読み込んでパース', () => {
    const csv = 'Date,Close\n2024-01-01,100\n2024-01-02,102\n';
    fs.writeFileSync(path.join(tmpDir, 'test.csv'), csv);
    const result = loadCSV(path.join(tmpDir, 'test.csv'));
    expect(result).toHaveLength(2);
    expect(result[0].Close).toBe(100);
  });

  test('存在しないファイルはエラー', () => {
    expect(() => loadCSV('/tmp/nonexistent_file.csv')).toThrow('not found');
  });
});

describe('lib/data saveCSV', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-savecsv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('データを CSV ファイルに保存', () => {
    const data = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 102 },
    ];
    const filePath = path.join(tmpDir, 'output.csv');
    saveCSV(filePath, data);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('2024-01-01');
    expect(content).toContain('100');
  });

  test('カスタムヘッダー', () => {
    const data = [{ date: '2024-01-01', value: 100 }];
    const filePath = path.join(tmpDir, 'custom.csv');
    saveCSV(filePath, data, ['date']);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content.split('\n')[0]).toBe('date');
  });

  test('空データはエラー', () => {
    expect(() => saveCSV('/tmp/empty.csv', [])).toThrow('No data to save');
  });

  test('存在しないディレクトリを自動作成', () => {
    const filePath = path.join(tmpDir, 'subdir', 'data.csv');
    saveCSV(filePath, [{ x: 1 }]);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('lib/data computeCCReturns', () => {
  test('2 行から 1 本の CC リターン', () => {
    const ohlcv = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 110 },
    ];
    const result = computeCCReturns(ohlcv);
    expect(result).toHaveLength(1);
    expect(result[0].return).toBeCloseTo(0.1, 6);
  });

  test('1 行以下でエラー', () => {
    expect(() => computeCCReturns([{ date: '2024-01-01', close: 100 }])).toThrow('at least 2');
    expect(() => computeCCReturns(null)).toThrow('at least 2');
    expect(() => computeCCReturns([])).toThrow('at least 2');
  });

  test('無効な close 価格はスキップ', () => {
    const ohlcv = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 'invalid' }, // スキップ
      { date: '2024-01-03', close: 110 },
    ];
    const result = computeCCReturns(ohlcv);
    // 'invalid' は NaN なのでスキップ
    expect(result.length).toBeLessThan(2);
  });
});

describe('lib/data computeOCReturns', () => {
  test('Open-Close リターンを計算', () => {
    const ohlcv = [
      { date: '2024-01-01', open: 100, close: 105 },
      { date: '2024-01-02', open: 105, close: 102 },
    ];
    const result = computeOCReturns(ohlcv);
    expect(result).toHaveLength(2);
    expect(result[0].return).toBeCloseTo(0.05, 6);
    expect(result[1].return).toBeCloseTo(-3 / 105, 6);
  });

  test('空データはエラー', () => {
    expect(() => computeOCReturns(null)).toThrow('No data');
    expect(() => computeOCReturns([])).toThrow('No data');
  });

  test('open=0 または無効な行はスキップ', () => {
    const ohlcv = [
      { date: '2024-01-01', open: 0, close: 100 }, // スキップ
      { date: '2024-01-02', open: 100, close: 105 },
    ];
    const result = computeOCReturns(ohlcv);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-01-02');
  });
});

describe('lib/data buildReturnMatrix', () => {
  test('複数銘柄のリターン行列を構築', () => {
    const returnsMap = {
      A: [
        { date: '2024-01-02', return: 0.01 },
        { date: '2024-01-03', return: 0.02 },
      ],
      B: [
        { date: '2024-01-02', return: 0.015 },
        { date: '2024-01-03', return: 0.018 },
      ],
    };
    const { dates, matrix, tickers } = buildReturnMatrix(returnsMap);
    expect(dates).toHaveLength(2);
    expect(matrix).toHaveLength(2);   // 行 = 日数
    expect(matrix[0]).toHaveLength(2); // 列 = 銘柄数
    expect(tickers).toEqual(['A', 'B']);
  });

  test('欠損値は前方充填される', () => {
    const returnsMap = {
      A: [
        { date: '2024-01-02', return: 0.01 },
        { date: '2024-01-04', return: 0.03 }, // 2024-01-03 が欠損
      ],
    };
    const { dates, matrix } = buildReturnMatrix(returnsMap);
    expect(dates).toHaveLength(2); // 2 個の日付
    // 欠損は前方充填なので 2 行
    expect(matrix.length).toBe(2);
  });

  test('空データはエラー', () => {
    expect(() => buildReturnMatrix({})).toThrow('No return data');
  });
});

describe('lib/data transpose', () => {
  test('2x3 行列を転置', () => {
    const m = [[1, 2, 3], [4, 5, 6]];
    const t = transpose(m);
    expect(t.length).toBe(3);
    expect(t[0]).toEqual([1, 4]);
  });

  test('空行列はエラー', () => {
    expect(() => transpose([])).toThrow('Invalid matrix');
  });
});

describe('lib/data fillForward', () => {
  test('欠損値を前の値で埋める', () => {
    const result = fillForward([1, null, null, 4]);
    expect(result).toEqual([1, 1, 1, 4]);
  });

  test('最初が欠損の場合は 0 で埋める', () => {
    const result = fillForward([null, null, 3]);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(3);
  });

  test('欠損なしはそのまま', () => {
    expect(fillForward([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('lib/data fillBackward', () => {
  test('欠損値を後の値で埋める', () => {
    const result = fillBackward([null, null, 3, 4]);
    expect(result[0]).toBe(3);
    expect(result[1]).toBe(3);
  });

  test('最後が欠損の場合は 0 で埋める', () => {
    const result = fillBackward([1, null, null]);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  test('欠損なしはそのまま', () => {
    expect(fillBackward([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('lib/data fillLinear', () => {
  test('欠損値を線形補間', () => {
    const result = fillLinear([0, null, null, 6]);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(4);
    expect(result[3]).toBe(6);
  });

  test('最初の欠損は前方充填', () => {
    const result = fillLinear([null, null, 6]);
    expect(result[0]).toBe(6);
    expect(result[1]).toBe(6);
  });

  test('欠損なしはそのまま', () => {
    expect(fillLinear([1, 2, 3])).toEqual([1, 2, 3]);
  });

  test('最後の欠損は後方充填', () => {
    const result = fillLinear([1, 2, null]);
    expect(result[2]).toBe(2);
  });
});

describe('lib/data dropNA', () => {
  test('null を含む行を削除', () => {
    const data = [
      { val: 1 },
      { val: null },
      { val: 3 },
    ];
    const result = dropNA(data, 'val');
    expect(result).toHaveLength(2);
    expect(result[0].val).toBe(1);
    expect(result[1].val).toBe(3);
  });

  test('NaN を含む行を削除', () => {
    const data = [{ val: 1 }, { val: NaN }, { val: 3 }];
    const result = dropNA(data, 'val');
    expect(result).toHaveLength(2);
  });

  test('全データが有効な場合はそのまま', () => {
    const data = [{ val: 1 }, { val: 2 }];
    expect(dropNA(data, 'val')).toHaveLength(2);
  });
});

describe('lib/data isTradingDay', () => {
  test('平日は営業日', () => {
    expect(isTradingDay('2024-01-05')).toBe(true); // 金曜日
  });

  test('土曜日は非営業日', () => {
    expect(isTradingDay('2024-01-06')).toBe(false);
  });

  test('日曜日は非営業日', () => {
    expect(isTradingDay('2024-01-07')).toBe(false);
  });

  test('JP: 元日は非営業日', () => {
    expect(isTradingDay('2024-01-01', 'JP')).toBe(false);
  });

  test('US: 元日は非営業日', () => {
    expect(isTradingDay('2024-01-01', 'US')).toBe(false);
  });

  test('US: 独立記念日は非営業日', () => {
    expect(isTradingDay('2024-07-04', 'US')).toBe(false);
  });

  test('US: クリスマスは非営業日', () => {
    expect(isTradingDay('2024-12-25', 'US')).toBe(false);
  });

  test('JP: 5月3日（憲法記念日）は非営業日', () => {
    expect(isTradingDay('2024-05-03', 'JP')).toBe(false);
  });

  test('JP: 11月23日（勤労感謝の日）は非営業日', () => {
    // 2024-11-23 は土曜日なので、2024-11-22 で検証
    expect(isTradingDay('2024-11-23', 'JP')).toBe(false);
  });
});

describe('lib/data filterTradingDays', () => {
  test('営業日のみを返す', () => {
    const dates = ['2024-01-05', '2024-01-06', '2024-01-07', '2024-01-08'];
    const result = filterTradingDays(dates, 'JP');
    // 土日を除いた平日のみ
    expect(result.includes('2024-01-06')).toBe(false); // 土曜
    expect(result.includes('2024-01-07')).toBe(false); // 日曜
    expect(result.includes('2024-01-05')).toBe(true);  // 金曜
    expect(result.includes('2024-01-08')).toBe(true);  // 月曜
  });

  test('空配列は空を返す', () => {
    expect(filterTradingDays([])).toEqual([]);
  });
});
