'use strict';

const { __internal } = require('../../src/server/services/strategyService');

const { computeOnePickTop1Backtest } = __internal;
const { computeDailyBuyCandidatesBacktest } = __internal;
const { computeDailyLongShortCandidatesBacktest } = __internal;
const { computeMonthlyPerformance } = __internal;

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

describe('strategyService daily buy candidates backtest', () => {
  test('computes basket daily profit and hit rate for buy candidates', () => {
    const nDays = 4;
    const retUs = makeSeries(nDays, [0.01]);
    const retJp = makeSeries(nDays, [0.01, 0.0]);
    const retJpOc = [
      { date: '2026-01-01', values: [0.0, 0.0] },
      { date: '2026-01-02', values: [0.02, -0.01] },
      { date: '2026-01-03', values: [-0.03, 0.01] },
      { date: '2026-01-04', values: [0.01, 0.01] }
    ];

    const signalGen = {
      computeSignal: jest
        .fn()
        .mockReturnValueOnce([0.9, 0.1]) // pick A
        .mockReturnValueOnce([0.8, 0.2]) // pick A
        .mockReturnValueOnce([0.7, 0.3]) // pick A
    };

    const jpData = {
      'A.T': [
        { date: '2026-01-02', open: 100, close: 102 }, // +2
        { date: '2026-01-03', open: 100, close: 97 }, // -3
        { date: '2026-01-04', open: 100, close: 101 } // +1
      ],
      'B.T': [
        { date: '2026-01-02', open: 100, close: 99 },
        { date: '2026-01-03', open: 100, close: 101 },
        { date: '2026-01-04', open: 100, close: 101 }
      ]
    };

    const result = computeDailyBuyCandidatesBacktest({
      retUs,
      retJp,
      retJpOc,
      signalConfig: { windowLength: 1, quantile: 0.4 },
      signalGen,
      sectorLabels: {},
      CFull: [[1, 0], [0, 1]],
      jpData,
      jpTickers: ['A.T', 'B.T']
    });

    expect(result.mode).toBe('daily_buy_candidates_each_1_share_sell_at_close');
    expect(result.buyCount).toBe(1);
    expect(result.tradedDays).toBe(3);
    expect(result.totalProfitYen).toBe(0); // +2 -3 +1
    expect(result.hitRatePct).toBeCloseTo(66.67, 2);
    expect(result.winDays).toBe(2);
    expect(result.lossDays).toBe(1);
    expect(result.flatDays).toBe(0);
    expect(result.last7Days.tradedDays).toBe(3);
    expect(result.last7Days.totalProfitYen).toBe(0);
    expect(result.last7Days.days).toHaveLength(3);
  });
});

describe('strategyService daily long-short candidates backtest', () => {
  test('computes long-short daily profit and hit rate', () => {
    const nDays = 4;
    const retUs = makeSeries(nDays, [0.01]);
    const retJp = makeSeries(nDays, [0.01, 0.0, -0.01, 0.02]);
    const retJpOc = [
      { date: '2026-01-01', values: [0.0, 0.0, 0.0, 0.0] },
      { date: '2026-01-02', values: [0.02, 0.01, -0.01, -0.02] },
      { date: '2026-01-03', values: [-0.03, 0.02, 0.01, -0.01] },
      { date: '2026-01-04', values: [0.01, -0.01, -0.02, 0.03] }
    ];

    const signalGen = {
      computeSignal: jest
        .fn()
        .mockReturnValueOnce([0.9, 0.2, -0.1, -0.8]) // long A, short D
        .mockReturnValueOnce([0.8, 0.1, -0.2, -0.7]) // long A, short D
        .mockReturnValueOnce([0.7, 0.2, -0.3, -0.6]) // long A, short D
    };

    const jpData = {
      'A.T': [
        { date: '2026-01-02', open: 100, close: 102 }, // +2
        { date: '2026-01-03', open: 100, close: 97 }, // -3
        { date: '2026-01-04', open: 100, close: 101 } // +1
      ],
      'B.T': [
        { date: '2026-01-02', open: 100, close: 101 },
        { date: '2026-01-03', open: 100, close: 102 },
        { date: '2026-01-04', open: 100, close: 99 }
      ],
      'C.T': [
        { date: '2026-01-02', open: 100, close: 99 },
        { date: '2026-01-03', open: 100, close: 101 },
        { date: '2026-01-04', open: 100, close: 98 }
      ],
      'D.T': [
        { date: '2026-01-02', open: 100, close: 98 }, // short +2
        { date: '2026-01-03', open: 100, close: 99 }, // short +1
        { date: '2026-01-04', open: 100, close: 103 } // short -3
      ]
    };

    const result = computeDailyLongShortCandidatesBacktest({
      retUs,
      retJp,
      retJpOc,
      signalConfig: { windowLength: 1, quantile: 0.4 },
      signalGen,
      sectorLabels: {},
      CFull: [[1, 0], [0, 1]],
      jpData,
      jpTickers: ['A.T', 'B.T', 'C.T', 'D.T']
    });

    // 日次: (+2 +2)=+4, (-3 +1)=-2, (+1 -3)=-2 => 合計 0
    expect(result.mode).toBe('daily_long_short_candidates_each_1_share_sell_at_close');
    expect(result.pickCount).toBe(1);
    expect(result.tradedDays).toBe(3);
    expect(result.totalProfitYen).toBe(0);
    expect(result.hitRatePct).toBeCloseTo(33.33, 2);
    expect(result.winDays).toBe(1);
    expect(result.lossDays).toBe(2);
    expect(result.flatDays).toBe(0);
    expect(result.last7Days.tradedDays).toBe(3);
    expect(result.last7Days.totalProfitYen).toBe(0);
    expect(result.last7Days.days).toHaveLength(3);
  });
});

describe('computeMonthlyPerformance', () => {
  test('groups daily data by month and computes aggregate stats', () => {
    const daily = [
      { date: '2026-01-05', dayProfitYen: 10 },
      { date: '2026-01-06', dayProfitYen: -5 },
      { date: '2026-01-07', dayProfitYen: 0 },
      { date: '2026-02-02', dayProfitYen: 20 },
      { date: '2026-02-03', dayProfitYen: 15 }
    ];
    const result = computeMonthlyPerformance(daily);
    expect(result).toHaveLength(2);

    const jan = result.find((m) => m.month === '2026-01');
    expect(jan).toBeDefined();
    expect(jan.tradedDays).toBe(3);
    expect(jan.totalProfitYen).toBe(5); // 10 - 5 + 0
    expect(jan.winDays).toBe(1);
    expect(jan.lossDays).toBe(1);
    expect(jan.flatDays).toBe(1);
    expect(jan.hitRatePct).toBeCloseTo(33.33, 2);

    const feb = result.find((m) => m.month === '2026-02');
    expect(feb).toBeDefined();
    expect(feb.tradedDays).toBe(2);
    expect(feb.totalProfitYen).toBe(35);
    expect(feb.winDays).toBe(2);
    expect(feb.lossDays).toBe(0);
    expect(feb.flatDays).toBe(0);
    expect(feb.hitRatePct).toBe(100);
  });

  test('returns empty array for empty input', () => {
    expect(computeMonthlyPerformance([])).toEqual([]);
  });

  test('skips entries without a date', () => {
    const daily = [
      { date: '2026-03-01', dayProfitYen: 5 },
      { dayProfitYen: 10 },
      { date: null, dayProfitYen: 3 }
    ];
    const result = computeMonthlyPerformance(daily);
    expect(result).toHaveLength(1);
    expect(result[0].tradedDays).toBe(1);
  });
});

describe('strategyService daily buy candidates backtest - last22Days and monthlyBreakdown', () => {
  test('includes last22Days and monthlyBreakdown in result', () => {
    const nDays = 6;
    const retUs = Array.from({ length: nDays }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      values: [0.01]
    }));
    const retJp = Array.from({ length: nDays }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      values: [0.01, 0.0]
    }));
    const retJpOc = Array.from({ length: nDays }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      values: [i % 2 === 0 ? 0.01 : -0.01, 0.0]
    }));
    const signalGen = {
      computeSignal: jest.fn().mockReturnValue([0.9, 0.1])
    };
    const jpData = {
      'A.T': Array.from({ length: nDays }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        open: 100,
        close: i % 2 === 0 ? 101 : 99
      })),
      'B.T': Array.from({ length: nDays }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        open: 100,
        close: 100
      }))
    };

    const result = computeDailyBuyCandidatesBacktest({
      retUs,
      retJp,
      retJpOc,
      signalConfig: { windowLength: 1, quantile: 0.1 },
      signalGen,
      sectorLabels: {},
      CFull: [[1, 0], [0, 1]],
      jpData,
      jpTickers: ['A.T', 'B.T']
    });

    expect(result).toHaveProperty('last22Days');
    expect(result.last22Days).toHaveProperty('tradedDays');
    expect(result.last22Days).toHaveProperty('totalProfitYen');
    expect(result.last22Days).toHaveProperty('hitRatePct');
    expect(result.last22Days).toHaveProperty('days');
    expect(result).toHaveProperty('monthlyBreakdown');
    expect(Array.isArray(result.monthlyBreakdown)).toBe(true);
  });
});

describe('strategyService daily long-short candidates backtest - last22Days and monthlyBreakdown', () => {
  test('includes last22Days and monthlyBreakdown in result', () => {
    const nDays = 4;
    const retUs = Array.from({ length: nDays }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      values: [0.01]
    }));
    const retJp = Array.from({ length: nDays }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      values: [0.01, 0.0]
    }));
    const retJpOc = [
      { date: '2026-01-01', values: [0.0, 0.0] },
      { date: '2026-01-02', values: [0.02, -0.01] },
      { date: '2026-01-03', values: [-0.03, 0.01] },
      { date: '2026-01-04', values: [0.01, 0.01] }
    ];
    const signalGen = {
      computeSignal: jest.fn()
        .mockReturnValueOnce([0.9, 0.1])
        .mockReturnValueOnce([0.1, 0.9])
        .mockReturnValueOnce([0.5, 0.5])
    };
    const jpData = {
      'A.T': [
        { date: '2026-01-02', open: 100, close: 102 },
        { date: '2026-01-03', open: 100, close: 97 },
        { date: '2026-01-04', open: 100, close: 101 }
      ],
      'B.T': [
        { date: '2026-01-02', open: 100, close: 99 },
        { date: '2026-01-03', open: 100, close: 101 },
        { date: '2026-01-04', open: 100, close: 101 }
      ]
    };

    const result = computeDailyLongShortCandidatesBacktest({
      retUs,
      retJp,
      retJpOc,
      signalConfig: { windowLength: 1, quantile: 0.5 },
      signalGen,
      sectorLabels: {},
      CFull: [[1, 0], [0, 1]],
      jpData,
      jpTickers: ['A.T', 'B.T']
    });

    expect(result).toHaveProperty('last22Days');
    expect(result.last22Days).toHaveProperty('tradedDays');
    expect(result.last22Days).toHaveProperty('totalProfitYen');
    expect(result.last22Days).toHaveProperty('days');
    expect(result).toHaveProperty('monthlyBreakdown');
    expect(Array.isArray(result.monthlyBreakdown)).toBe(true);
    expect(result.monthlyBreakdown.length).toBeGreaterThan(0);
    expect(result.monthlyBreakdown[0].month).toBe('2026-01');
  });
});

