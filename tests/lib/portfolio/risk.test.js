'use strict';

const {
  applyTransactionCosts,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdownDetail
} = require('../../../lib/portfolio');

describe('lib/portfolio/risk', () => {
  describe('applyTransactionCosts', () => {
    test('取引コストを適用', () => {
      const ret = 0.01;
      const costs = { slippage: 0.001, commission: 0.0005 };
      const result = applyTransactionCosts(ret, costs);

      expect(result).toBeLessThan(ret);
    });

    test('コストなし', () => {
      const ret = 0.01;
      const result = applyTransactionCosts(ret, null);
      expect(result).toBe(0.01);
    });

    test('undefinedコスト', () => {
      const ret = 0.01;
      const result = applyTransactionCosts(ret, undefined);
      expect(result).toBe(0.01);
    });

    test('スリッページのみ', () => {
      const ret = 0.01;
      const costs = { slippage: 0.002 };
      const result = applyTransactionCosts(ret, costs);

      expect(result).toBeLessThan(ret);
    });

    test('手数料のみ', () => {
      const ret = 0.01;
      const costs = { commission: 0.002 };
      const result = applyTransactionCosts(ret, costs);

      expect(result).toBeLessThan(ret);
    });

    test('コストがリターンより大きい場合', () => {
      const ret = 0.001;
      const costs = { slippage: 0.01, commission: 0.01 };
      const result = applyTransactionCosts(ret, costs);

      expect(result).toBeLessThan(0);
    });

    test('負のリターンに適用', () => {
      const ret = -0.01;
      const costs = { slippage: 0.001, commission: 0.0005 };
      const result = applyTransactionCosts(ret, costs);

      expect(result).toBeLessThan(ret);
    });

    test('デフォルト値0', () => {
      const ret = 0.01;
      const costs = {};
      const result = applyTransactionCosts(ret, costs);

      expect(result).toBe(ret);
    });
  });

  describe('computeSharpeRatio', () => {
    test('基本計算', () => {
      const returns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const sharpe = computeSharpeRatio(returns);

      expect(typeof sharpe).toBe('number');
    });

    test('デフォルトリスクフリーレート0', () => {
      const returns = [0.01, 0.02, 0.015];
      const sharpe = computeSharpeRatio(returns);
      expect(sharpe).toBeDefined();
    });

    test('カスタムリスクフリーレート', () => {
      const returns = [0.01, 0.02, 0.015];
      const sharpe = computeSharpeRatio(returns, 0.02);
      expect(sharpe).toBeDefined();
    });

    test('空データで0を返す', () => {
      const sharpe = computeSharpeRatio([]);
      expect(sharpe).toBe(0);
    });

    test('nullデータで0を返す', () => {
      const sharpe = computeSharpeRatio(null);
      expect(sharpe).toBe(0);
    });

    test('undefinedデータで0を返す', () => {
      const sharpe = computeSharpeRatio(undefined);
      expect(sharpe).toBe(0);
    });

    test('RISKが0の場合0を返す', () => {
      const returns = [0, 0, 0, 0];
      const sharpe = computeSharpeRatio(returns);
      expect(sharpe).toBe(0);
    });

    test('カスタム年率換算係数', () => {
      const returns = [0.01, 0.02, 0.015];
      const sharpe = computeSharpeRatio(returns, 0, 12);
      expect(sharpe).toBeDefined();
    });

    test('負の Sharpe レシオ', () => {
      const returns = [-0.01, -0.02, -0.015];
      const sharpe = computeSharpeRatio(returns);
      expect(sharpe).toBeLessThan(0);
    });
  });

  describe('computeSortinoRatio', () => {
    test('基本計算', () => {
      const returns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const sortino = computeSortinoRatio(returns);

      expect(typeof sortino).toBe('number');
    });

    test('デフォルトtargetReturnは0', () => {
      const returns = [0.01, 0.02, 0.015];
      const sortino = computeSortinoRatio(returns);
      expect(sortino).toBeDefined();
    });

    test('カスタムtargetReturn', () => {
      const returns = [0.01, 0.02, 0.015];
      const sortino = computeSortinoRatio(returns, 0.05);
      expect(sortino).toBeDefined();
    });

    test('空データで0を返す', () => {
      const sortino = computeSortinoRatio([]);
      expect(sortino).toBe(0);
    });

    test('nullデータで0を返す', () => {
      const sortino = computeSortinoRatio(null);
      expect(sortino).toBe(0);
    });

    test('undefinedデータで0を返す', () => {
      const sortino = computeSortinoRatio(undefined);
      expect(sortino).toBe(0);
    });

    test('下方偏差がない場合正のときにInfinity', () => {
      const returns = [0.01, 0.02, 0.015, 0.01];
      const sortino = computeSortinoRatio(returns);
      expect(sortino).toBe(Infinity);
    });

    test('下方偏差がない場合負のときに計算される', () => {
      const returns = [-0.01, -0.02, -0.015, -0.01];
      const sortino = computeSortinoRatio(returns);
      expect(sortino).toBeLessThan(0);
    });

    test('カスタム年率換算係数', () => {
      const returns = [0.01, 0.02, 0.015];
      const sortino = computeSortinoRatio(returns, 0, 12);
      expect(sortino).toBeDefined();
    });

    test('混合リターンで計算', () => {
      const returns = [0.02, -0.01, 0.03, -0.02, 0.015];
      const sortino = computeSortinoRatio(returns);
      expect(typeof sortino).toBe('number');
    });
  });

  describe('computeMaxDrawdownDetail', () => {
    test('基本計算', () => {
      const returns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const detail = computeMaxDrawdownDetail(returns);

      expect(detail.MDD).toBeDefined();
      expect(detail.start).toBeDefined();
      expect(detail.end).toBeDefined();
      expect(detail.recovery).toBeDefined();
    });

    test('空データでデフォルト値を返す', () => {
      const detail = computeMaxDrawdownDetail([]);
      expect(detail.MDD).toBe(0);
      expect(detail.start).toBe(0);
      expect(detail.end).toBe(0);
      expect(detail.recovery).toBeNull();
    });

    test('nullデータでデフォルト値を返す', () => {
      const detail = computeMaxDrawdownDetail(null);
      expect(detail.MDD).toBe(0);
    });

    test('undefinedデータでデフォルト値を返す', () => {
      const detail = computeMaxDrawdownDetail(undefined);
      expect(detail.MDD).toBe(0);
    });

    test('単一要素で計算', () => {
      const returns = [0.01];
      const detail = computeMaxDrawdownDetail(returns);
      expect(detail.MDD).toBe(0);
    });

    test('下降トレンドで отрицательное MDD', () => {
      const returns = [0.05, -0.03, -0.10, -0.05, -0.02];
      const detail = computeMaxDrawdownDetail(returns);
      expect(detail.MDD).toBeLessThan(0);
    });

    test('上昇トレンドで MDD = 0', () => {
      const returns = [0.01, 0.02, 0.03, 0.02, 0.04];
      const detail = computeMaxDrawdownDetail(returns);
      expect(detail.MDD).toBe(0);
    });

    test('回復後も記録', () => {
      const returns = [0.05, -0.10, -0.05, 0.02, 0.15];
      const detail = computeMaxDrawdownDetail(returns);
      expect(detail.recovery).not.toBeNull();
    });

    test('回復なしの下降トレンド', () => {
      const returns = [0.05, -0.10, -0.15, -0.05];
      const detail = computeMaxDrawdownDetail(returns);
      expect(detail.recovery).toBeNull();
    });

    test('インデックスが正しい', () => {
      const returns = [0.05, -0.03, -0.10, 0.02, -0.05, 0.01];
      const detail = computeMaxDrawdownDetail(returns);

      expect(detail.start).toBeLessThanOrEqual(detail.end);
      expect(detail.end).toBeLessThan(returns.length);
    });

    test('大きなデータセット', () => {
      const returns = Array.from({ length: 1000 }, () => (Math.random() - 0.5) * 0.04);
      const detail = computeMaxDrawdownDetail(returns);
      expect(detail.MDD).toBeDefined();
    });
  });
});