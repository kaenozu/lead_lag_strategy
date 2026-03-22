'use strict';

const { SubspaceRegularizedPCA } = require('../../../lib/pca');

describe('lib/pca/subspace', () => {
  describe('constructor', () => {
    test('デフォルトパラメータでインスタンス作成', () => {
      const pca = new SubspaceRegularizedPCA();
      expect(pca.config.lambdaReg).toBe(0.9);
      expect(pca.config.nFactors).toBe(3);
    });

    test('カスタムパラメータでインスタンス作成', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.5, nFactors: 5 });
      expect(pca.config.lambdaReg).toBe(0.5);
      expect(pca.config.nFactors).toBe(5);
    });

    test('部分的なパラメータ', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.7 });
      expect(pca.config.lambdaReg).toBe(0.7);
      expect(pca.config.nFactors).toBe(3);
    });

    test('nFactorsのみ', () => {
      const pca = new SubspaceRegularizedPCA({ nFactors: 4 });
      expect(pca.config.lambdaReg).toBe(0.9);
      expect(pca.config.nFactors).toBe(4);
    });

    test('orderedSectorKeysを設定', () => {
      const pca = new SubspaceRegularizedPCA({ orderedSectorKeys: ['US_1', 'US_2', 'JP_1'] });
      expect(pca.orderedSectorKeys).toEqual(['US_1', 'US_2', 'JP_1']);
    });

    test('V0, D0, C0 は初期状態で null', () => {
      const pca = new SubspaceRegularizedPCA();
      expect(pca.V0).toBeNull();
      expect(pca.D0).toBeNull();
      expect(pca.C0).toBeNull();
    });
  });

  describe('buildPriorSpace', () => {
    test('事前空間を構築', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });
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
      expect(pca.D0).not.toBeNull();
      expect(pca.V0.length).toBe(6);
      expect(pca.C0.length).toBe(6);
      expect(pca.D0.length).toBe(3);
    });

    test('orderedSectorKeysを使って構築', () => {
      const pca = new SubspaceRegularizedPCA({
        orderedSectorKeys: ['US_1', 'US_2', 'US_3', 'JP_1', 'JP_2', 'JP_3']
      });
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
    });

    test('異なるセクター数', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });
      const nUs = 4;
      const nJp = 2;
      const sectorLabels = {
        US_1: 'cyclical',
        US_2: 'defensive',
        US_3: 'neutral',
        US_4: 'cyclical',
        JP_1: 'defensive',
        JP_2: 'neutral'
      };
      const CFull = Array.from({ length: 6 }, (_, i) =>
        Array.from({ length: 6 }, (_, j) => i === j ? 1 : 0.3)
      );

      pca.buildPriorSpace(nUs, nJp, sectorLabels, CFull);

      expect(pca.V0.length).toBe(6);
    });

    test('C0 は相関行列として対角が1', () => {
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

      for (let i = 0; i < 6; i++) {
        expect(pca.C0[i][i]).toBeCloseTo(1, 5);
      }
    });

    test('sectorLabelsのkeys数がNと異なる場合はエラー', () => {
      const pca = new SubspaceRegularizedPCA();
      const nUs = 3;
      const nJp = 3;
      const sectorLabels = {
        US_1: 'cyclical',
        US_2: 'defensive',
        US_3: 'neutral',
        JP_1: 'cyclical',
        JP_2: 'defensive',
        JP_3: 'neutral',
        JP_4: 'extra'
      };
      const CFull = [
        [1, 0.5, 0.5, 0.3, 0.3, 0.3],
        [0.5, 1, 0.5, 0.3, 0.3, 0.3],
        [0.5, 0.5, 1, 0.3, 0.3, 0.3],
        [0.3, 0.3, 0.3, 1, 0.5, 0.5],
        [0.3, 0.3, 0.3, 0.5, 1, 0.5],
        [0.3, 0.3, 0.3, 0.5, 0.5, 1]
      ];

      expect(() => pca.buildPriorSpace(nUs, nJp, sectorLabels, CFull)).toThrow();
    });
  });

  describe('computeRegularizedPCA', () => {
    test('PCA計算', () => {
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

      const { VK, eigenvalues, CReg, converged } = pca.computeRegularizedPCA(returns, sectorLabels, CFull);

      expect(VK).toBeDefined();
      expect(eigenvalues).toBeDefined();
      expect(CReg).toBeDefined();
      expect(converged).toBeDefined();
      expect(VK.length).toBe(6);
    });

    test('buildPriorSpaceが自動呼ばれる', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025, 0.018],
        [0.02, 0.015, 0.01, 0.018, 0.01, 0.022],
        [-0.01, -0.005, -0.008, -0.012, -0.006, -0.01]
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

      pca.computeRegularizedPCA(returns, sectorLabels, CFull);

      expect(pca.C0).not.toBeNull();
    });

    test('CRegは正則化されている', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025, 0.018],
        [0.02, 0.015, 0.01, 0.018, 0.01, 0.022]
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

      const { CReg } = pca.computeRegularizedPCA(returns, sectorLabels, CFull);

      for (let i = 0; i < 6; i++) {
        expect(CReg[i][i]).toBeCloseTo(1, 5);
      }
    });

    test('eigenvaluesは降順', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025, 0.018],
        [0.02, 0.015, 0.01, 0.018, 0.01, 0.022],
        [-0.01, -0.005, -0.008, -0.012, -0.006, -0.01]
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

      const { eigenvalues } = pca.computeRegularizedPCA(returns, sectorLabels, CFull);

      for (let i = 1; i < eigenvalues.length; i++) {
        expect(eigenvalues[i - 1]).toBeGreaterThanOrEqual(eigenvalues[i]);
      }
    });
  });

  describe('computePlainPCA', () => {
    test('基本計算', () => {
      const pca = new SubspaceRegularizedPCA({ nFactors: 3 });

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025, 0.018],
        [0.02, 0.015, 0.01, 0.018, 0.01, 0.022],
        [-0.01, -0.005, -0.008, -0.012, -0.006, -0.01],
        [0.005, 0.008, 0.003, 0.006, 0.004, 0.007]
      ];

      const { VK, eigenvalues, converged } = pca.computePlainPCA(returns, 3);

      expect(VK).toBeDefined();
      expect(eigenvalues).toBeDefined();
      expect(converged).toBeDefined();
      expect(VK.length).toBe(6);
      expect(eigenvalues.length).toBe(3);
    });

    test('デフォルトnFactors', () => {
      const pca = new SubspaceRegularizedPCA();

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025],
        [0.02, 0.015, 0.01, 0.018, 0.01]
      ];

      const { eigenvalues } = pca.computePlainPCA(returns);
      expect(eigenvalues.length).toBe(3);
    });

    test('カスタムnFactors', () => {
      const pca = new SubspaceRegularizedPCA();

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025],
        [0.02, 0.015, 0.01, 0.018, 0.01]
      ];

      const { eigenvalues } = pca.computePlainPCA(returns, 2);
      expect(eigenvalues.length).toBe(2);
    });

    test('VKはN行xK列', () => {
      const pca = new SubspaceRegularizedPCA();

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025],
        [0.02, 0.015, 0.01, 0.018, 0.01]
      ];

      const { VK } = pca.computePlainPCA(returns, 2);
      expect(VK.length).toBe(5);
      expect(VK[0].length).toBe(2);
    });

    test('eigenvaluesは降順', () => {
      const pca = new SubspaceRegularizedPCA();

      const returns = [
        [0.01, 0.02, 0.015, 0.01, 0.025, 0.018],
        [0.02, 0.015, 0.01, 0.018, 0.01, 0.022],
        [-0.01, -0.005, -0.008, -0.012, -0.006, -0.01]
      ];

      const { eigenvalues } = pca.computePlainPCA(returns, 3);

      for (let i = 1; i < eigenvalues.length; i++) {
        expect(eigenvalues[i - 1]).toBeGreaterThanOrEqual(eigenvalues[i]);
      }
    });
  });
});