/**
 * lib/pca.js のテスト
 */

'use strict';

const { SubspaceRegularizedPCA, LeadLagSignal } = require('../../lib/pca');

describe('lib/pca', () => {
  describe('SubspaceRegularizedPCA', () => {
    test('インスタンス作成', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });
      expect(pca.config.lambdaReg).toBe(0.9);
      expect(pca.config.nFactors).toBe(3);
    });

    test('デフォルトパラメータ', () => {
      const pca = new SubspaceRegularizedPCA();
      expect(pca.config.lambdaReg).toBe(0.9);
      expect(pca.config.nFactors).toBe(3);
    });

    test('buildPriorSpaceで事前空間を構築', () => {
      const pca = new SubspaceRegularizedPCA();
      const nUs = 3;
      const nJp = 3;
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

      pca.buildPriorSpace(nUs, nJp, sectorLabels, CFull);

      expect(pca.V0).not.toBeNull();
      expect(pca.C0).not.toBeNull();
      expect(pca.V0.length).toBe(6);
      expect(pca.C0.length).toBe(6);
    });

    test('computeRegularizedPCAでPCA計算', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });
      
      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025, 0.018],
        [0.02, 0.015, 0.01, 0.018, 0.01, 0.022],
        [-0.01, -0.005, -0.008, -0.012, -0.006, -0.01],
        [0.005, 0.008, 0.003, 0.006, 0.004, 0.007],
        [0.015, 0.012, 0.018, 0.014, 0.016, 0.019]
      ];

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

      const { VK, eigenvalues, CReg } = pca.computeRegularizedPCA(returns, sectorLabels, CFull);

      expect(VK).toBeDefined();
      expect(eigenvalues).toBeDefined();
      expect(CReg).toBeDefined();
      expect(VK.length).toBe(6); // N assets
    });
  });

  describe('LeadLagSignal', () => {
    test('インスタンス作成', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3 });
      expect(signal.config.lambdaReg).toBe(0.9);
      expect(signal.pca).toBeInstanceOf(SubspaceRegularizedPCA);
    });

    test('computeSignalでシグナル計算', () => {
      const signal = new LeadLagSignal({ lambdaReg: 0.9, nFactors: 3 });

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

      const result = signal.computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull);

      expect(result).toBeDefined();
      expect(result.length).toBe(3);
      expect(typeof result[0]).toBe('number');
    });

    test('空データでエラーをスロー', () => {
      const signal = new LeadLagSignal();
      
      expect(() => signal.computeSignal([], [], [], {}, [])).toThrow();
    });
  });
});
