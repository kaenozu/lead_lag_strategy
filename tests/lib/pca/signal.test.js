'use strict';

const { LeadLagSignal } = require('../../../lib/pca');

describe('lib/pca/signal', () => {
  describe('constructor', () => {
    test('デフォルトパラメータでインスタンス作成', () => {
      const signal = new LeadLagSignal();
      expect(signal.config).toBeDefined();
      expect(signal.pca).toBeDefined();
    });

    test('カスタムパラメータでインスタンス作成', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.5, nFactors: 5 });
      expect(signal.config.lambdaReg).toBe(0.5);
      expect(signal.config.nFactors).toBe(5);
      expect(signal.pca.config.lambdaReg).toBe(0.5);
      expect(signal.pca.config.nFactors).toBe(5);
    });

    test('PCAインスタンスが正しく初期化', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.7, nFactors: 4 });
      expect(signal.pca.config.lambdaReg).toBe(0.7);
      expect(signal.pca.config.nFactors).toBe(4);
    });
  });

  describe('computeSignal', () => {
    const sectorLabels = {
      US_1: 'cyclical',
      US_2: 'defensive',
      US_3: 'neutral',
      JP_1: 'cyclical',
      JP_2: 'defensive',
      JP_3: 'neutral'
    };

    const CFull = [
      [1, 0.5, 0.5, 0.3, 0.3, 0.3],
      [0.5, 1, 0.5, 0.3, 0.3, 0.3],
      [0.5, 0.5, 1, 0.3, 0.3, 0.3],
      [0.3, 0.3, 0.3, 1, 0.5, 0.5],
      [0.3, 0.3, 0.3, 0.5, 1, 0.5],
      [0.3, 0.3, 0.3, 0.5, 0.5, 1]
    ];

    test('基本計算', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3, windowLength: 5 });

      const returnsUs = [
        [0.01, 0.02, 0.015],
        [0.02, 0.015, 0.01],
        [-0.01, -0.005, -0.008],
        [0.005, 0.008, 0.003],
        [0.015, 0.012, 0.018]
      ];

      const returnsJp = [
        [0.01, 0.025, 0.018],
        [0.018, 0.01, 0.022],
        [-0.012, -0.006, -0.01],
        [0.006, 0.004, 0.007],
        [0.014, 0.016, 0.019]
      ];

      const returnsUsLatest = [0.012, 0.018, 0.015];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      expect(result).toBeDefined();
      expect(result.length).toBe(3);
      expect(typeof result[0]).toBe('number');
    });

    test('空returnsUsでエラーをスロー', () => {
      const signal = new LeadLagSignal();

      expect(() =>
        signal.computeSignal([], [0.01, 0.02], [0.01], sectorLabels, CFull)
      ).toThrow();
    });

    test('空returnsJpでエラーをスロー', () => {
      const signal = new LeadLagSignal();

      expect(() =>
        signal.computeSignal([0.01, 0.02], [], [0.01], sectorLabels, CFull)
      ).toThrow();
    });

    test('空returnsUsLatestでエラーをスロー', () => {
      const signal = new LeadLagSignal();

      const returnsUs = [[0.01, 0.02]];
      const returnsJp = [[0.01, 0.02]];

      expect(() =>
        signal.computeSignal(returnsUs, returnsJp, [], sectorLabels, CFull)
      ).toThrow();
    });

    test('null returnsUsでエラーをスロー', () => {
      const signal = new LeadLagSignal();

      expect(() =>
        signal.computeSignal(null, [0.01], [0.01], sectorLabels, CFull)
      ).toThrow();
    });

    test('null returnsJpでエラーをスロー', () => {
      const signal = new LeadLagSignal();

      expect(() =>
        signal.computeSignal([0.01], null, [0.01], sectorLabels, CFull)
      ).toThrow();
    });

    test('null returnsUsLatestでエラーをスロー', () => {
      const signal = new LeadLagSignal();

      const returnsUs = [[0.01, 0.02]];
      const returnsJp = [[0.01, 0.02]];

      expect(() =>
        signal.computeSignal(returnsUs, returnsJp, null, sectorLabels, CFull)
      ).toThrow();
    });

    test('異なるセクター数', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3, windowLength: 3 });

      const returnsUs = [
        [0.01, 0.02],
        [0.02, 0.015],
        [-0.01, -0.005]
      ];

      const returnsJp = [
        [0.01, 0.025, 0.018, 0.02],
        [0.018, 0.01, 0.022, 0.015],
        [-0.012, -0.006, -0.01, -0.008]
      ];

      const returnsUsLatest = [0.012, 0.018];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, {
        US_1: 'cyclical',
        US_2: 'defensive',
        JP_1: 'cyclical',
        JP_2: 'defensive',
        JP_3: 'neutral',
        JP_4: 'cyclical'
      }, CFull);

      expect(result.length).toBe(4);
    });

    test('シグナルが数値を返す', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3, windowLength: 2 });

      const returnsUs = [
        [0.01, 0.02, 0.015],
        [0.02, 0.015, 0.01]
      ];

      const returnsJp = [
        [0.01, 0.025, 0.018],
        [0.018, 0.01, 0.022]
      ];

      const returnsUsLatest = [0.012, 0.018, 0.015];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      result.forEach(v => {
        expect(typeof v).toBe('number');
        expect(isNaN(v)).toBe(false);
      });
    });

    test('2つのサンプルで計算', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3, windowLength: 2 });

      const returnsUs = [
        [0.01, 0.02, 0.015],
        [0.02, 0.015, 0.01]
      ];

      const returnsJp = [
        [0.01, 0.025, 0.018],
        [0.018, 0.01, 0.022]
      ];

      const returnsUsLatest = [0.012, 0.018, 0.015];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      expect(result.length).toBe(3);
    });

    test(' многиеサンプルで計算', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3 });

      const returnsUs = Array.from({ length: 100 }, () => [
        Math.random() * 0.04 - 0.02,
        Math.random() * 0.04 - 0.02,
        Math.random() * 0.04 - 0.02
      ]);

      const returnsJp = Array.from({ length: 100 }, () => [
        Math.random() * 0.04 - 0.02,
        Math.random() * 0.04 - 0.02,
        Math.random() * 0.04 - 0.02
      ]);

      const returnsUsLatest = [0.012, 0.018, 0.015];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      expect(result.length).toBe(3);
    });

    test('カスタムlambdaReg', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.5, nFactors: 2, windowLength: 2 });

      const returnsUs = [
        [0.01, 0.02, 0.015],
        [0.02, 0.015, 0.01]
      ];

      const returnsJp = [
        [0.01, 0.025, 0.018],
        [0.018, 0.01, 0.022]
      ];

      const returnsUsLatest = [0.012, 0.018, 0.015];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      expect(result.length).toBe(3);
    });

    test('異なるnFactors', () => {
      const signal = new LeadLagSignal({ nFactors: 2, windowLength: 2 });

      const returnsUs = [
        [0.01, 0.02, 0.015],
        [0.02, 0.015, 0.01]
      ];

      const returnsJp = [
        [0.01, 0.025, 0.018],
        [0.018, 0.01, 0.022]
      ];

      const returnsUsLatest = [0.012, 0.018, 0.015];

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      expect(result.length).toBe(3);
    });
  });
});