'use strict';

const { __internal } = require('../../src/server/services/strategyService');

const { computeOnePickTop1Backtest } = __internal;

function makeSeries(nDays, values) {
  return Array.from({ length: nDays }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    values: values.slice()
  }));
}

describe('strategyService one-pick backtest', () => {
  test('computes profit and cumulative return for top-1 one-share strategy', () => {
    const nDays = 4;
    const retUs = makeSeries(nDays, [0.01]);
    const retJp = makeSeries(nDays, [0.01, 0.0]);
    const retJpOc = [
      { date: '2026-01-01', values: [0.0, 0.0] },
      { date: '2026-01-02', values: [0.02, -0.01] },
      { date: '2026-01-03', values: [0.03, -0.01] },
      { date: '2026-01-04', values: [-0.01, 0.01] }
    ];

    const signalGen = {
      computeSignal: jest
        .fn()
        .mockReturnValueOnce([0.9, 0.1]) // pick first on 2026-01-02
        .mockReturnValueOnce([0.8, 0.2]) // pick first on 2026-01-03
        .mockReturnValueOnce([0.7, 0.3]) // pick first on 2026-01-04
    };

    const jpData = {
      'A.T': [
        { date: '2026-01-02', open: 100, close: 102 }, // +2
        { date: '2026-01-03', open: 100, close: 103 }, // +3
        { date: '2026-01-04', open: 100, close: 99 } // -1
      ],
      'B.T': [
        { date: '2026-01-02', open: 100, close: 99 },
        { date: '2026-01-03', open: 100, close: 99 },
        { date: '2026-01-04', open: 100, close: 101 }
      ]
    };

    const result = computeOnePickTop1Backtest({
      retUs,
      retJp,
      retJpOc,
      signalConfig: { windowLength: 1 },
      signalGen,
      sectorLabels: {},
      CFull: [[1, 0], [0, 1]],
      jpData,
      jpTickers: ['A.T', 'B.T']
    });

    expect(result.totalDays).toBe(3);
    expect(result.tradedDays).toBe(3);
    expect(result.totalProfitYen).toBe(4); // 2 + 3 - 1
    // (1+0.02)*(1+0.03)*(1-0.01)-1 = 0.040094
    expect(result.cumulativeReturnPct).toBeCloseTo(4.01, 2);
    expect(result.hitRatePct).toBeCloseTo(66.67, 2);
    expect(result.winDays).toBe(2);
    expect(result.lossDays).toBe(1);
    expect(result.flatDays).toBe(0);
    expect(result.last7Days.tradedDays).toBe(3);
    expect(result.last7Days.totalProfitYen).toBe(4);
    expect(result.last7Days.hitRatePct).toBeCloseTo(66.67, 2);
    expect(result.last7Days.winDays).toBe(2);
    expect(result.last7Days.lossDays).toBe(1);
    expect(result.last7Days.flatDays).toBe(0);
    expect(result.last7Days.trades).toHaveLength(3);
    expect(result.lastTrade).toEqual({
      date: '2026-01-04',
      ticker: 'A.T',
      dailyProfitYen: -1,
      dailyReturnPct: -1
    });
  });
});

