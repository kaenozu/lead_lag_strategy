'use strict';

const {
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('../../../lib/portfolio');

describe('lib/portfolio/metrics', () => {
  describe('computePerformanceMetrics', () => {
    test('基本計算', () => {
      const returns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const metrics = computePerformanceMetrics(returns);

      expect(metrics.AR).toBeDefined();
      expect(metrics.RISK).toBeDefined();
      expect(metrics.RR).toBeDefined();
      expect(metrics.MDD).toBeDefined();
      expect(metrics.Cumulative).toBeDefined();
    });

    test('空データでゼロ値を返す', () => {
      const metrics = computePerformanceMetrics([]);
      expect(metrics.AR).toBe(0);
      expect(metrics.RISK).toBe(0);
      expect(metrics.RR).toBe(0);
      expect(metrics.MDD).toBe(0);
      expect(metrics.Cumulative).toBe(1);
    });

    test('nullデータでゼロ値を返す', () => {
      const metrics = computePerformanceMetrics(null);
      expect(metrics.AR).toBe(0);
      expect(metrics.RISK).toBe(0);
    });

    test('undefinedデータでゼロ値を返す', () => {
      const metrics = computePerformanceMetrics(undefined);
      expect(metrics.AR).toBe(0);
      expect(metrics.RISK).toBe(0);
    });

    test('年率換算', () => {
      const returns = [0.001, 0.001, 0.001, 0.001];
      const metrics = computePerformanceMetrics(returns, 252);
      expect(metrics.AR).toBeGreaterThan(0);
    });

    test('カスタム年率換算係数', () => {
      const returns = [0.001, 0.001, 0.001, 0.001];
      const metrics = computePerformanceMetrics(returns, 12);
      expect(metrics.AR).toBeGreaterThan(0);
    });

    test('単一リターンで計算', () => {
      const returns = [0.01];
      const metrics = computePerformanceMetrics(returns);
      expect(metrics.AR).toBe(0.01 * 252);
      expect(metrics.Cumulative).toBe(1.01);
    });

    test('負のリターンで計算', () => {
      const returns = [-0.01, -0.02, -0.015];
      const metrics = computePerformanceMetrics(returns);
      expect(metrics.AR).toBeLessThan(0);
      expect(metrics.Cumulative).toBeLessThan(1);
    });

    test('RISKが0の場合RRは0', () => {
      const returns = [0, 0, 0, 0];
      const metrics = computePerformanceMetrics(returns);
      expect(metrics.RISK).toBe(0);
      expect(metrics.RR).toBe(0);
    });

    test('リターンがすべて同じの場合', () => {
      const returns = [0.01, 0.01, 0.01, 0.01];
      const metrics = computePerformanceMetrics(returns);
      expect(metrics.RISK).toBe(0);
      expect(metrics.RR).toBe(0);
    });

    test(' большойデータセットで計算', () => {
      const returns = Array.from({ length: 1000 }, () => (Math.random() - 0.5) * 0.04);
      const metrics = computePerformanceMetrics(returns);
      expect(metrics.AR).toBeDefined();
      expect(metrics.RISK).toBeDefined();
    });

    test('MDD計算', () => {
      const returns = [0.05, -0.03, -0.10, 0.02, -0.05, 0.01];
      const metrics = computePerformanceMetrics(returns);
      expect(metrics.MDD).toBeLessThan(0);
    });
  });

  describe('computeYearlyPerformance', () => {
    test('年別パフォーマンス計算', () => {
      const results = [
        { date: '2024-01-01', return: 0.01 },
        { date: '2024-01-02', return: 0.02 },
        { date: '2025-01-01', return: 0.015 },
        { date: '2025-01-02', return: 0.025 }
      ];

      const yearly = computeYearlyPerformance(results);

      expect(yearly['2024']).toBeDefined();
      expect(yearly['2025']).toBeDefined();
      expect(yearly['2024'].AR).toBeDefined();
      expect(yearly['2025'].AR).toBeDefined();
    });

    test('空データで空オブジェクトを返す', () => {
      expect(computeYearlyPerformance([])).toEqual({});
    });

    test('nullデータで空オブジェクトを返す', () => {
      expect(computeYearlyPerformance(null)).toEqual({});
    });

    test('undefinedデータで空オブジェクトを返す', () => {
      expect(computeYearlyPerformance(undefined)).toEqual({});
    });

    test('日付なしデータで無視', () => {
      const results = [
        { return: 0.01 },
        { return: 0.02 }
      ];
      const yearly = computeYearlyPerformance(results);
      expect(Object.keys(yearly).length).toBe(0);
    });

    test('複数の年を正確に計算', () => {
      const results = [
        { date: '2023-12-01', return: 0.01 },
        { date: '2023-12-15', return: 0.02 },
        { date: '2024-01-01', return: 0.015 },
        { date: '2024-06-01', return: 0.025 },
        { date: '2025-01-01', return: 0.01 }
      ];

      const yearly = computeYearlyPerformance(results);
      expect(yearly['2023']).toBeDefined();
      expect(yearly['2024']).toBeDefined();
      expect(yearly['2025']).toBeDefined();
    });

    test('全ての年にメトリクスが存在', () => {
      const results = [
        { date: '2024-01-01', return: 0.01 },
        { date: '2024-02-01', return: 0.02 },
        { date: '2025-01-01', return: 0.015 }
      ];

      const yearly = computeYearlyPerformance(results);
      expect(yearly['2024'].AR).toBeDefined();
      expect(yearly['2024'].RISK).toBeDefined();
      expect(yearly['2024'].RR).toBeDefined();
      expect(yearly['2024'].MDD).toBeDefined();
    });
  });

  describe('computeRollingMetrics', () => {
    test('ローリングウィンドウ分析', () => {
      const returns = Array.from({ length: 300 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        return: (Math.random() - 0.5) * 0.02
      }));

      const rolling = computeRollingMetrics(returns, 60);

      expect(rolling.length).toBe(241);
    });

    test('デフォルトウィンドウサイズ', () => {
      const returns = Array.from({ length: 300 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        return: (Math.random() - 0.5) * 0.02
      }));

      const rolling = computeRollingMetrics(returns);
      expect(rolling.length).toBe(49);
    });

    test('ウィンドウサイズ以下のデータで空配列を返す', () => {
      const returns = [{ date: '2024-01-01', return: 0.01 }];
      expect(computeRollingMetrics(returns, 60)).toEqual([]);
    });

    test('ウィンドウサイズ Exactly で1つの結果', () => {
      const returns = Array.from({ length: 60 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        return: 0.001
      }));

      const rolling = computeRollingMetrics(returns, 60);
      expect(rolling.length).toBe(1);
    });

    test('nullデータで空配列を返す', () => {
      expect(computeRollingMetrics(null, 60)).toEqual([]);
    });

    test('undefinedデータで空配列を返す', () => {
      expect(computeRollingMetrics(undefined, 60)).toEqual([]);
    });

    test('結果に必須フィールドがある', () => {
      const returns = Array.from({ length: 120 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        return: (Math.random() - 0.5) * 0.02
      }));

      const rolling = computeRollingMetrics(returns, 60);

      expect(rolling[0].endIndex).toBeDefined();
      expect(rolling[0].date).toBeDefined();
      expect(rolling[0].RR).toBeDefined();
      expect(rolling[0].AR).toBeDefined();
      expect(rolling[0].MDD).toBeDefined();
    });

    test('日付がない場合はデフォルトラベル', () => {
      const returns = Array.from({ length: 120 }, (_, i) => ({
        return: 0.001
      }));

      const rolling = computeRollingMetrics(returns, 60);
      expect(rolling[0].date).toMatch(/^Day /);
    });

    test('カスタムウィンドウサイズ', () => {
      const returns = Array.from({ length: 200 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        return: (Math.random() - 0.5) * 0.02
      }));

      const rolling = computeRollingMetrics(returns, 100);
      expect(rolling.length).toBe(101);
    });
  });
});