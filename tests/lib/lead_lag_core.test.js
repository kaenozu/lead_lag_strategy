/**
 * lib/lead_lag_core.js のテスト
 */

'use strict';

const {
  setEigenSeed,
  transpose,
  dotProduct,
  norm,
  normalize,
  diag,
  makeDiag,
  matmul,
  eigenDecomposition,
  correlationMatrix,
  SubspacePCA,
  LeadLagSignal,
} = require('../../lib/lead_lag_core');

describe('lib/lead_lag_core', () => {
  beforeEach(() => {
    // 再現性のためシードを固定
    setEigenSeed(42);
  });

  describe('setEigenSeed', () => {
    test('数値シードを設定できる', () => {
      expect(() => setEigenSeed(123)).not.toThrow();
    });

    test('非数値は 42 にフォールバック', () => {
      expect(() => setEigenSeed('bad')).not.toThrow();
    });

    test('小数は切り捨て', () => {
      expect(() => setEigenSeed(3.7)).not.toThrow();
    });
  });

  describe('transpose', () => {
    test('2x3 行列を転置すると 3x2', () => {
      const m = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      const t = transpose(m);
      expect(t.length).toBe(3);
      expect(t[0].length).toBe(2);
      expect(t[0]).toEqual([1, 4]);
      expect(t[1]).toEqual([2, 5]);
      expect(t[2]).toEqual([3, 6]);
    });

    test('正方行列の転置', () => {
      const m = [
        [1, 2],
        [3, 4],
      ];
      const t = transpose(m);
      expect(t[0][0]).toBe(1);
      expect(t[0][1]).toBe(3);
      expect(t[1][0]).toBe(2);
      expect(t[1][1]).toBe(4);
    });
  });

  describe('dotProduct', () => {
    test('基本的な内積', () => {
      expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
    });

    test('直交ベクトルは 0', () => {
      expect(dotProduct([1, 0], [0, 1])).toBe(0);
    });

    test('ゼロベクトルは 0', () => {
      expect(dotProduct([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe('norm', () => {
    test('既知のノルム', () => {
      expect(norm([3, 4])).toBeCloseTo(5);
    });

    test('単位ベクトルは 1', () => {
      expect(norm([1, 0, 0])).toBeCloseTo(1);
    });

    test('ゼロベクトルは 0', () => {
      expect(norm([0, 0, 0])).toBe(0);
    });
  });

  describe('normalize', () => {
    test('非ゼロベクトルを正規化', () => {
      const v = normalize([3, 4]);
      expect(norm(v)).toBeCloseTo(1);
      expect(v[0]).toBeCloseTo(0.6);
      expect(v[1]).toBeCloseTo(0.8);
    });

    test('ゼロに近いベクトルはそのまま返す', () => {
      const v = [0, 0];
      const result = normalize(v);
      // ノルムが 1e-10 以下の場合、そのまま返す
      expect(result).toEqual([0, 0]);
    });
  });

  describe('diag', () => {
    test('行列の対角要素を抽出', () => {
      const m = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ];
      expect(diag(m)).toEqual([1, 5, 9]);
    });

    test('2x2 行列', () => {
      expect(diag([[3, 0], [0, 7]])).toEqual([3, 7]);
    });
  });

  describe('makeDiag', () => {
    test('ベクトルから対角行列を作成', () => {
      const m = makeDiag([2, 3, 4]);
      expect(m[0][0]).toBe(2);
      expect(m[1][1]).toBe(3);
      expect(m[2][2]).toBe(4);
      expect(m[0][1]).toBe(0);
      expect(m[1][0]).toBe(0);
    });
  });

  describe('matmul', () => {
    test('2x2 行列の積', () => {
      const A = [[1, 2], [3, 4]];
      const B = [[5, 6], [7, 8]];
      const C = matmul(A, B);
      expect(C[0][0]).toBe(19);
      expect(C[0][1]).toBe(22);
      expect(C[1][0]).toBe(43);
      expect(C[1][1]).toBe(50);
    });

    test('単位行列との積は自分自身', () => {
      const A = [[1, 2], [3, 4]];
      const I = [[1, 0], [0, 1]];
      const result = matmul(A, I);
      expect(result[0]).toEqual([1, 2]);
      expect(result[1]).toEqual([3, 4]);
    });

    test('矩形行列の積', () => {
      const A = [[1, 2, 3]];       // 1x3
      const B = [[1], [2], [3]];   // 3x1
      const C = matmul(A, B);
      expect(C[0][0]).toBe(14);    // 1+4+9
    });
  });

  describe('eigenDecomposition', () => {
    test('対角行列の固有値は対角要素', () => {
      setEigenSeed(42);
      const A = [
        [3, 0, 0],
        [0, 2, 0],
        [0, 0, 1],
      ];
      const { eigenvalues } = eigenDecomposition(A, 2);
      expect(eigenvalues[0]).toBeCloseTo(3, 4);
      expect(eigenvalues[1]).toBeCloseTo(2, 4);
    });

    test('対称行列の固有値分解', () => {
      setEigenSeed(42);
      const A = [
        [2, 1],
        [1, 2],
      ];
      const { eigenvalues } = eigenDecomposition(A, 2);
      expect(eigenvalues[0]).toBeCloseTo(3, 4);
      expect(eigenvalues[1]).toBeCloseTo(1, 4);
    });

    test('k を指定すると k 個の固有値を返す', () => {
      setEigenSeed(42);
      const A = [
        [4, 1, 0],
        [1, 3, 1],
        [0, 1, 2],
      ];
      const { eigenvalues, eigenvectors } = eigenDecomposition(A, 2);
      expect(eigenvalues).toHaveLength(2);
      expect(eigenvectors).toHaveLength(2);
    });
  });

  describe('correlationMatrix', () => {
    test('完全相関', () => {
      const data = [
        [1, 2],
        [2, 4],
        [3, 6],
      ];
      const C = correlationMatrix(data);
      expect(C[0][0]).toBeCloseTo(1);
      expect(C[1][1]).toBeCloseTo(1);
      expect(C[0][1]).toBeCloseTo(1);
    });

    test('対称性', () => {
      const data = [
        [1, 2, 3],
        [4, 1, 5],
        [2, 3, 1],
        [5, 4, 2],
      ];
      const C = correlationMatrix(data);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(C[i][j]).toBeCloseTo(C[j][i], 10);
        }
      }
    });

    test('対角は 1', () => {
      const data = [
        [1, 3],
        [2, 1],
        [3, 4],
      ];
      const C = correlationMatrix(data);
      expect(C[0][0]).toBeCloseTo(1);
      expect(C[1][1]).toBeCloseTo(1);
    });

    test('定数列は 0（標準偏差が 0）', () => {
      const data = [
        [1, 5],
        [1, 3],
        [1, 7],
      ];
      const C = correlationMatrix(data);
      // 定数列は標準偏差 0 なので相関は 0
      expect(C[0][1]).toBe(0);
    });
  });

  describe('SubspacePCA', () => {
    const makeTestData = () => ({
      nUs: 2,
      nJp: 2,
      labels: {
        US_A: 'cyclical',
        US_B: 'defensive',
        JP_A: 'cyclical',
        JP_B: 'neutral',
      },
      CFull: [
        [1.0, 0.4, 0.2, 0.1],
        [0.4, 1.0, 0.15, 0.12],
        [0.2, 0.15, 1.0, 0.35],
        [0.1, 0.12, 0.35, 1.0],
      ],
      returns: [
        [0.01, 0.02, 0.015, 0.011],
        [0.02, 0.015, 0.01, 0.018],
        [-0.01, -0.005, -0.008, -0.012],
        [0.005, 0.008, 0.003, 0.006],
        [0.015, 0.012, 0.018, 0.014],
      ],
    });

    test('インスタンスを作成できる', () => {
      const pca = new SubspacePCA({ lambdaReg: 0.85, nFactors: 2 });
      expect(pca.config.lambdaReg).toBe(0.85);
      expect(pca.C0).toBeNull();
    });

    test('buildPriorSpace が事前行列を構築する', () => {
      const { nUs, nJp, labels, CFull } = makeTestData();
      const pca = new SubspacePCA({ lambdaReg: 0.85, nFactors: 2 });
      pca.buildPriorSpace(nUs, nJp, labels, CFull);

      expect(pca.C0).not.toBeNull();
      expect(pca.C0.length).toBe(nUs + nJp);
      // 対角は 1 に正規化されている
      for (let i = 0; i < pca.C0.length; i++) {
        expect(pca.C0[i][i]).toBeCloseTo(1);
      }
    });

    test('compute が正規化済みリターンから VK を返す', () => {
      setEigenSeed(42);
      const { nUs, nJp, labels, CFull, returns } = makeTestData();
      const n = nUs + nJp;
      const nFactors = 2;
      const pca = new SubspacePCA({ lambdaReg: 0.85, nFactors });
      pca.buildPriorSpace(nUs, nJp, labels, CFull);

      const VK = pca.compute(returns, labels, CFull);
      expect(VK.length).toBeGreaterThan(0);
      // compute は transpose(eigenvectors) を返す: n行 × nFactors列
      expect(VK.length).toBe(n);
      expect(VK[0].length).toBe(nFactors);
    });

    test('C0 未構築でも compute 呼び出しで自動構築', () => {
      setEigenSeed(42);
      const { labels, CFull, returns } = makeTestData();
      const pca = new SubspacePCA({ lambdaReg: 0.85, nFactors: 2 });
      expect(pca.C0).toBeNull();

      const VK = pca.compute(returns, labels, CFull);
      expect(pca.C0).not.toBeNull();
      expect(VK).toBeDefined();
    });

    test('buildPriorSpace: 全 neutral ラベルでも動作する', () => {
      const labels = {
        US_A: 'neutral',
        US_B: 'neutral',
        JP_A: 'neutral',
        JP_B: 'neutral',
      };
      const CFull = [
        [1.0, 0.3, 0.2, 0.1],
        [0.3, 1.0, 0.15, 0.1],
        [0.2, 0.15, 1.0, 0.3],
        [0.1, 0.1, 0.3, 1.0],
      ];
      const pca = new SubspacePCA({ lambdaReg: 0.5, nFactors: 2 });
      expect(() => pca.buildPriorSpace(2, 2, labels, CFull)).not.toThrow();
    });
  });

  describe('LeadLagSignal', () => {
    const makeSignalData = () => ({
      retUs: [
        [0.01, 0.02],
        [0.02, 0.015],
        [-0.01, -0.005],
        [0.005, 0.008],
        [0.015, 0.012],
      ],
      retJp: [
        [0.015, 0.011],
        [0.01, 0.018],
        [-0.008, -0.012],
        [0.003, 0.006],
        [0.018, 0.014],
      ],
      retUsLatest: [0.012, 0.018],
      labels: {
        US_A: 'cyclical',
        US_B: 'defensive',
        JP_A: 'cyclical',
        JP_B: 'neutral',
      },
      CFull: [
        [1.0, 0.4, 0.2, 0.1],
        [0.4, 1.0, 0.15, 0.12],
        [0.2, 0.15, 1.0, 0.35],
        [0.1, 0.12, 0.35, 1.0],
      ],
    });

    test('インスタンスを作成できる', () => {
      const sig = new LeadLagSignal({ lambdaReg: 0.85, nFactors: 2 });
      expect(sig.config.lambdaReg).toBe(0.85);
      expect(sig.pca).toBeInstanceOf(SubspacePCA);
    });

    test('compute が JP 銘柄数のシグナルを返す', () => {
      setEigenSeed(42);
      const { retUs, retJp, retUsLatest, labels, CFull } = makeSignalData();
      const sig = new LeadLagSignal({ lambdaReg: 0.85, nFactors: 2 });
      const result = sig.compute(retUs, retJp, retUsLatest, labels, CFull);
      expect(result).toBeDefined();
      expect(result.length).toBe(retJp[0].length);
      result.forEach(v => expect(typeof v).toBe('number'));
    });

    test('同一シードで結果が再現される', () => {
      const { retUs, retJp, retUsLatest, labels, CFull } = makeSignalData();

      setEigenSeed(42);
      const sig1 = new LeadLagSignal({ lambdaReg: 0.85, nFactors: 2 });
      const r1 = sig1.compute(retUs, retJp, retUsLatest, labels, CFull);

      setEigenSeed(42);
      const sig2 = new LeadLagSignal({ lambdaReg: 0.85, nFactors: 2 });
      const r2 = sig2.compute(retUs, retJp, retUsLatest, labels, CFull);

      for (let i = 0; i < r1.length; i++) {
        expect(r1[i]).toBeCloseTo(r2[i], 10);
      }
    });

    test('nFactors > 銘柄数でも動作する', () => {
      setEigenSeed(42);
      const { retUs, retJp, retUsLatest, labels, CFull } = makeSignalData();
      const sig = new LeadLagSignal({ lambdaReg: 0.5, nFactors: 4 });
      expect(() => sig.compute(retUs, retJp, retUsLatest, labels, CFull)).not.toThrow();
    });
  });
});
