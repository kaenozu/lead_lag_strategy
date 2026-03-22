/**
 * lib/lead_lag_matrices.js のテスト
 */

'use strict';

const { computeReturns, buildLeadLagMatrices } = require('../../lib/lead_lag_matrices');

describe('lib/lead_lag_matrices computeReturns', () => {
  describe('cc モード（終値→終値リターン）', () => {
    test('2 本から 1 本のリターン', () => {
      const ohlc = [
        { date: '2024-01-01', open: 100, close: 100 },
        { date: '2024-01-02', open: 100, close: 110 },
      ];
      const r = computeReturns(ohlc, 'cc');
      expect(r).toHaveLength(1);
      expect(r[0].date).toBe('2024-01-02');
      expect(r[0].return).toBeCloseTo(0.1, 6);
    });

    test('3 本から 2 本のリターン', () => {
      const ohlc = [
        { date: '2024-01-01', open: 100, close: 100 },
        { date: '2024-01-02', open: 100, close: 110 },
        { date: '2024-01-03', open: 110, close: 99 },
      ];
      const r = computeReturns(ohlc, 'cc');
      expect(r).toHaveLength(2);
      expect(r[1].return).toBeCloseTo(-0.1, 5);
    });

    test('1 本以下は空配列', () => {
      expect(computeReturns([], 'cc')).toEqual([]);
      expect(computeReturns([{ date: 'a', open: 1, close: 100 }], 'cc')).toEqual([]);
    });

    test('マイナスリターン', () => {
      const ohlc = [
        { date: '2024-01-01', open: 1, close: 200 },
        { date: '2024-01-02', open: 200, close: 100 },
      ];
      const r = computeReturns(ohlc, 'cc');
      expect(r[0].return).toBeCloseTo(-0.5, 6);
    });
  });

  describe('oc モード（日中リターン）', () => {
    test('open から close へのリターン', () => {
      const ohlc = [
        { date: '2024-01-02', open: 100, close: 105 },
      ];
      const r = computeReturns(ohlc, 'oc');
      expect(r).toHaveLength(1);
      expect(r[0].date).toBe('2024-01-02');
      expect(r[0].return).toBeCloseTo(0.05, 6);
    });

    test('open=0 の行はスキップ', () => {
      const ohlc = [
        { date: '2024-01-01', open: 0, close: 100 },
        { date: '2024-01-02', open: 100, close: 110 },
      ];
      const r = computeReturns(ohlc, 'oc');
      expect(r).toHaveLength(1);
      expect(r[0].date).toBe('2024-01-02');
    });

    test('複数行', () => {
      const ohlc = [
        { date: '2024-01-01', open: 100, close: 102 },
        { date: '2024-01-02', open: 102, close: 105 },
      ];
      const r = computeReturns(ohlc, 'oc');
      expect(r).toHaveLength(2);
    });

    test('空配列は空を返す', () => {
      expect(computeReturns([], 'oc')).toEqual([]);
    });
  });
});

describe('lib/lead_lag_matrices buildLeadLagMatrices', () => {
  // 共通テストデータを用意
  const makeData = () => {
    const usData = {
      'XLK': [
        { date: '2024-01-01', open: 100, close: 100 },
        { date: '2024-01-02', open: 100, close: 102 },
        { date: '2024-01-03', open: 102, close: 105 },
        { date: '2024-01-04', open: 105, close: 104 },
      ],
      'XLF': [
        { date: '2024-01-01', open: 50, close: 50 },
        { date: '2024-01-02', open: 50, close: 51 },
        { date: '2024-01-03', open: 51, close: 52 },
        { date: '2024-01-04', open: 52, close: 51.5 },
      ],
    };
    const jpData = {
      'JPTECH': [
        { date: '2024-01-01', open: 200, close: 200 },
        { date: '2024-01-02', open: 200, close: 204 },
        { date: '2024-01-03', open: 204, close: 210 },
        { date: '2024-01-04', open: 210, close: 208 },
      ],
      'JPFIN': [
        { date: '2024-01-01', open: 300, close: 300 },
        { date: '2024-01-02', open: 300, close: 303 },
        { date: '2024-01-03', open: 303, close: 306 },
        { date: '2024-01-04', open: 306, close: 304 },
      ],
    };
    return { usData, jpData };
  };

  test('基本的な行列構築', () => {
    const { usData, jpData } = makeData();
    const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(
      usData, jpData, ['XLK', 'XLF'], ['JPTECH', 'JPFIN']
    );
    expect(retUs.length).toBeGreaterThan(0);
    expect(retJp.length).toBe(retUs.length);
    expect(retJpOc.length).toBe(retUs.length);
    expect(dates.length).toBe(retUs.length);
  });

  test('各行の values の次元が正しい', () => {
    const { usData, jpData } = makeData();
    const { retUs, retJp, retJpOc } = buildLeadLagMatrices(
      usData, jpData, ['XLK', 'XLF'], ['JPTECH', 'JPFIN']
    );
    for (const row of retUs) {
      expect(row.values).toHaveLength(2); // 2 US tickers
    }
    for (const row of retJp) {
      expect(row.values).toHaveLength(2); // 2 JP tickers
    }
    for (const row of retJpOc) {
      expect(row.values).toHaveLength(2); // 2 JP tickers
    }
  });

  test('minDate でフィルタリング', () => {
    const { usData, jpData } = makeData();
    const allResult = buildLeadLagMatrices(
      usData, jpData, ['XLK', 'XLF'], ['JPTECH', 'JPFIN']
    );
    const filteredResult = buildLeadLagMatrices(
      usData, jpData, ['XLK', 'XLF'], ['JPTECH', 'JPFIN'],
      { minDate: '2024-01-04' }
    );
    expect(filteredResult.dates.length).toBeLessThanOrEqual(allResult.dates.length);
    for (const d of filteredResult.dates) {
      expect(d >= '2024-01-04').toBe(true);
    }
  });

  test('銘柄が空のデータは欠損行を除外', () => {
    const usData = {
      'XLK': [
        { date: '2024-01-01', open: 100, close: 100 },
        { date: '2024-01-02', open: 100, close: 102 },
      ],
      // 'XLF' はデータなし
    };
    const jpData = {
      'JPTECH': [
        { date: '2024-01-01', open: 200, close: 200 },
        { date: '2024-01-02', open: 200, close: 204 },
      ],
    };
    // XLF のデータが欠けているので retUs の values に null が含まれる行はスキップ
    const { retUs } = buildLeadLagMatrices(
      usData, jpData, ['XLK', 'XLF'], ['JPTECH'],
      {}
    );
    // XLF のデータがない行は除外される
    expect(retUs.length).toBe(0);
  });

  test('日付が重ならない場合は空の結果', () => {
    const usData = {
      'XLK': [
        { date: '2024-01-01', open: 100, close: 100 },
        { date: '2024-01-02', open: 100, close: 102 },
      ],
    };
    const jpData = {
      'JPTECH': [
        { date: '2024-02-01', open: 200, close: 200 },
        { date: '2024-02-02', open: 200, close: 204 },
      ],
    };
    const { retUs, retJp, dates } = buildLeadLagMatrices(
      usData, jpData, ['XLK'], ['JPTECH']
    );
    expect(dates.length).toBe(0);
    expect(retUs.length).toBe(0);
    expect(retJp.length).toBe(0);
  });

  test('空 usData は空の結果', () => {
    const { retUs, dates } = buildLeadLagMatrices(
      {}, {}, ['XLK'], ['JPTECH']
    );
    expect(retUs.length).toBe(0);
    expect(dates.length).toBe(0);
  });

  test('oc リターンが cc リターンと同じ日付を持つ', () => {
    const { usData, jpData } = makeData();
    const { retJp, retJpOc } = buildLeadLagMatrices(
      usData, jpData, ['XLK', 'XLF'], ['JPTECH', 'JPFIN']
    );
    for (let i = 0; i < retJp.length; i++) {
      expect(retJp[i].date).toBe(retJpOc[i].date);
    }
  });
});
