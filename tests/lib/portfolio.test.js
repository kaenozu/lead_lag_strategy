/**
 * lib/portfolio.js のテスト
 */

'use strict';

const portfolio = require('../../lib/portfolio');

describe('lib/portfolio', () => {
  describe('buildPortfolio', () => {
    test('基本的なポートフォリオ構築', () => {
      const signal = [0.5, -0.3, 0.8, -0.1, 0.2, 0.9, -0.4, 0.1];
      const weights = portfolio.buildPortfolio(signal, 0.25);
      
      expect(weights.length).toBe(8);
      
      const positiveCount = weights.filter(w => w > 0).length;
      const negativeCount = weights.filter(w => w < 0).length;
      
      expect(positiveCount).toBe(2);
      expect(negativeCount).toBe(2);
    });

    test('quantile=0.3で上位30%がロング、下位30%がショート', () => {
      const signal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const weights = portfolio.buildPortfolio(signal, 0.3);
      
      const longWeight = weights.filter(w => w > 0).reduce((a, b) => a + b, 0);
      const shortWeight = weights.filter(w => w < 0).reduce((a, b) => a + b, 0);
      
      expect(longWeight).toBeCloseTo(1);
      expect(shortWeight).toBeCloseTo(-1);
    });

    test('空シグナルでエラーをスロー', () => {
      expect(() => portfolio.buildPortfolio([], 0.3)).toThrow('Invalid signal');
    });

    test('無効なquantileでエラーをスロー', () => {
      expect(() => portfolio.buildPortfolio([1, 2, 3], 0)).toThrow('Invalid quantile');
      expect(() => portfolio.buildPortfolio([1, 2, 3], 0.6)).toThrow('Invalid quantile');
    });
  });

  describe('buildDoubleSortPortfolio', () => {
    test('ダブルソートポートフォリオ構築', () => {
      const momSignal = [0.1, 0.2, 0.3, 0.4, 0.5];
      const pcaSignal = [0.5, 0.4, 0.3, 0.2, 0.1];
      const weights = portfolio.buildDoubleSortPortfolio(momSignal, pcaSignal, 0.2);
      
      expect(weights.length).toBe(5);
    });

    test('次元不一致でエラーをスロー', () => {
      expect(() => 
        portfolio.buildDoubleSortPortfolio([1, 2, 3], [1, 2], 0.3)
      ).toThrow('Signal dimension mismatch');
    });
  });

  describe('computePerformanceMetrics', () => {
    test('基本計算', () => {
      const returns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const metrics = portfolio.computePerformanceMetrics(returns);
      
      expect(metrics.AR).toBeDefined();
      expect(metrics.RISK).toBeDefined();
      expect(metrics.RR).toBeDefined();
      expect(metrics.MDD).toBeDefined();
      expect(metrics.Cumulative).toBeDefined();
    });

    test('空データでゼロ値を返す', () => {
      const metrics = portfolio.computePerformanceMetrics([]);
      expect(metrics.AR).toBe(0);
      expect(metrics.RISK).toBe(0);
    });

    test('年率換算', () => {
      const returns = [0.001, 0.001, 0.001, 0.001];
      const metrics = portfolio.computePerformanceMetrics(returns, 252);
      expect(metrics.AR).toBeGreaterThan(0);
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
      
      const yearly = portfolio.computeYearlyPerformance(results);
      
      expect(yearly['2024']).toBeDefined();
      expect(yearly['2025']).toBeDefined();
    });

    test('空データで空オブジェクトを返す', () => {
      expect(portfolio.computeYearlyPerformance([])).toEqual({});
    });
  });

  describe('computeRollingMetrics', () => {
    test('ローリングウィンドウ分析', () => {
      const returns = Array.from({ length: 300 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        return: (Math.random() - 0.5) * 0.02
      }));
      
      const rolling = portfolio.computeRollingMetrics(returns, 60);
      
      expect(rolling.length).toBe(241);
    });

    test('ウィンドウサイズ以下のデータで空配列を返す', () => {
      const returns = [{ date: '2024-01-01', return: 0.01 }];
      expect(portfolio.computeRollingMetrics(returns, 60)).toEqual([]);
    });
  });

  describe('applyTransactionCosts', () => {
    test('取引コストを適用', () => {
      const ret = 0.01;
      const costs = { slippage: 0.001, commission: 0.0005 };
      const result = portfolio.applyTransactionCosts(ret, costs);
      
      expect(result).toBeLessThan(ret);
    });

    test('コストなし', () => {
      const ret = 0.01;
      const result = portfolio.applyTransactionCosts(ret, null);
      expect(result).toBe(0.01);
    });
  });
});
