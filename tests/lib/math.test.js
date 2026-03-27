/**
 * lib/math.js のテスト（改良版）
 */

'use strict';

const math = require('../../lib/math');

describe('lib/math - Enhanced', () => {
  describe('validateNumber', () => {
    test('有効な数値', () => {
      expect(() => math.validateNumber(42)).not.toThrow();
    });

    test('NaN でエラー', () => {
      expect(() => math.validateNumber(NaN)).toThrow('Invalid number');
    });

    test('Infinity でエラー', () => {
      expect(() => math.validateNumber(Infinity)).toThrow('Invalid number');
    });
  });

  describe('validateMatrix', () => {
    test('有効な行列', () => {
      expect(() => math.validateMatrix([[1, 2], [3, 4]])).not.toThrow();
    });

    test('空行列でエラー', () => {
      expect(() => math.validateMatrix([])).toThrow('Invalid matrix');
    });

    test('不一致の行長でエラー', () => {
      expect(() => math.validateMatrix([[1, 2], [3]])).toThrow('inconsistent length');
    });
  });

  describe('eigenDecomposition', () => {
    test('対称行列の固有値分解', () => {
      const matrix = [
        [2, 1],
        [1, 2]
      ];
      const { eigenvalues, eigenvectors, converged } = math.eigenDecomposition(matrix, 2);
      
      expect(eigenvalues.length).toBe(2);
      expect(eigenvectors.length).toBe(2);
      expect(converged).toBe(true);
      
      // 固有値の検証（理論値：3, 1）
      expect(eigenvalues[0]).toBeCloseTo(3, 5);
      expect(eigenvalues[1]).toBeCloseTo(1, 5);
    });

    test('収束判定', () => {
      const matrix = [
        [4, 1, 1],
        [1, 4, 1],
        [1, 1, 4]
      ];
      const { converged } = math.eigenDecomposition(matrix, 3, 1000, 1e-6);
      expect(converged).toBe(true);
    });

    test('k パラメータで取得数を制限', () => {
      const matrix = [
        [2, 1, 0.5],
        [1, 2, 1],
        [0.5, 1, 2]
      ];
      const { eigenvalues } = math.eigenDecomposition(matrix, 2);
      expect(eigenvalues.length).toBe(2);
    });
  });

  describe('correlationMatrix - Optimized', () => {
    test('相関行列の計算', () => {
      const data = [
        [1, 2],
        [2, 4],
        [3, 6],
        [4, 8]
      ];
      const result = math.correlationMatrix(data);
      
      expect(result[0][0]).toBeCloseTo(1);
      expect(result[1][1]).toBeCloseTo(1);
      expect(result[0][1]).toBeCloseTo(1);
      expect(result[1][0]).toBeCloseTo(1); // 対称性
    });

    test('対称性の検証', () => {
      const data = [
        [1.5, 2.3, 3.1],
        [2.1, 3.5, 4.2],
        [1.8, 2.9, 3.7],
        [2.5, 3.8, 4.5]
      ];
      const corr = math.correlationMatrix(data);
      
      // 対称性のチェック
      for (let i = 0; i < corr.length; i++) {
        for (let j = i + 1; j < corr.length; j++) {
          expect(corr[i][j]).toBeCloseTo(corr[j][i], 10);
        }
      }
    });

    test('空データでエラー', () => {
      expect(() => math.correlationMatrix([])).toThrow('Invalid matrix');
    });

    test('サンプル数が少なすぎる場合は単位行列を返す', () => {
      const result = math.correlationMatrix([[1, 2]]);
      // n < 2 の場合は単位行列を返す（フォールバック）
      expect(result).toEqual([
        [1, 0],
        [0, 1]
      ]);
    });
  });

  describe('correlationMatrixSample (numpy corrcoef 相当)', () => {
    test('2 変数・3 観測で検証', () => {
      const data = [
        [1, 4],
        [2, -1],
        [3, 3]
      ];
      const c = math.correlationMatrixSample(data);
      // np.corrcoef(data.T) と一致
      expect(c[0][0]).toBeCloseTo(1, 8);
      expect(c[1][1]).toBeCloseTo(1, 8);
      expect(c[0][1]).toBeCloseTo(-0.5 / Math.sqrt(7), 8);
      expect(c[1][0]).toBeCloseTo(c[0][1], 8);
    });
  });

  describe('eigenSymmetricTopK', () => {
    test('対角行列の固有値', () => {
      const A = [
        [3, 0, 0],
        [0, 1, 0],
        [0, 0, 2]
      ];
      const { eigenvalues } = math.eigenSymmetricTopK(A, 2);
      expect(eigenvalues[0]).toBeCloseTo(3);
      expect(eigenvalues[1]).toBeCloseTo(2);
    });
  });

  describe('normalize - Enhanced', () => {
    test('ベクトルの正規化', () => {
      const v = [3, 4];
      const result = math.normalize(v);
      expect(result[0]).toBeCloseTo(0.6);
      expect(result[1]).toBeCloseTo(0.8);
      expect(math.norm(result)).toBeCloseTo(1);
    });

    test('ゼロベクトルでエラー', () => {
      expect(() => math.normalize([0, 0])).toThrow('Cannot normalize zero vector');
    });
  });

  describe('trace', () => {
    test('行列のトレース', () => {
      const matrix = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ];
      expect(math.trace(matrix)).toBe(15);
    });

    test('非正方行列でエラー', () => {
      expect(() => math.trace([[1, 2], [3, 4], [5, 6]])).toThrow('must be square');
    });
  });

  describe('frobeniusNorm', () => {
    test('フロベニウスノルム', () => {
      const matrix = [
        [1, 2],
        [3, 4]
      ];
      const expected = Math.sqrt(1 + 4 + 9 + 16);
      expect(math.frobeniusNorm(matrix)).toBeCloseTo(expected);
    });
  });

  describe('identity', () => {
    test('単位行列の作成', () => {
      const result = math.identity(3);
      expect(result).toEqual([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]);
    });

    test('無効なサイズでエラー', () => {
      expect(() => math.identity(0)).toThrow('must be positive');
    });
  });

  // ============================================================
  // 改善 1: ewmaCorrelationMatrix
  // ============================================================
  describe('ewmaCorrelationMatrix', () => {
    const sampleData = [
      [0.01, 0.02, 0.015],
      [0.02, 0.015, 0.01],
      [-0.01, -0.005, -0.008],
      [0.005, 0.008, 0.003],
      [0.015, 0.012, 0.018]
    ];

    test('N×N の正方行列を返す', () => {
      const C = math.ewmaCorrelationMatrix(sampleData, 30);
      expect(C.length).toBe(3);
      expect(C[0].length).toBe(3);
    });

    test('対角要素がすべて 1', () => {
      const C = math.ewmaCorrelationMatrix(sampleData, 30);
      for (let i = 0; i < 3; i++) {
        expect(C[i][i]).toBeCloseTo(1.0, 10);
      }
    });

    test('対称行列である', () => {
      const C = math.ewmaCorrelationMatrix(sampleData, 30);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(C[i][j]).toBeCloseTo(C[j][i], 10);
        }
      }
    });

    test('非対角要素が [-1, 1] の範囲内', () => {
      const C = math.ewmaCorrelationMatrix(sampleData, 30);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(C[i][j]).toBeGreaterThanOrEqual(-1.0001);
          expect(C[i][j]).toBeLessThanOrEqual(1.0001);
        }
      }
    });

    test('halflife が短いほど直近観測への感度が高い（サンプル相関と異なる）', () => {
      const C_sample = math.correlationMatrixSample(sampleData);
      const C_ewma15 = math.ewmaCorrelationMatrix(sampleData, 15);
      const C_ewma60 = math.ewmaCorrelationMatrix(sampleData, 60);

      // halflife=15 のほうが halflife=60 よりサンプル相関から離れていることを確認
      const diff15 = Math.abs(C_ewma15[0][1] - C_sample[0][1]);
      const diff60 = Math.abs(C_ewma60[0][1] - C_sample[0][1]);
      expect(diff15).toBeGreaterThanOrEqual(diff60);
    });

    test('サンプル数が 1 のときは単位行列を返す', () => {
      const result = math.ewmaCorrelationMatrix([[0.01, 0.02]], 30);
      // n < 2 の場合は単位行列を返す（フォールバック）
      expect(result).toEqual([
        [1, 0],
        [0, 1]
      ]);
    });

    test('halflife が 0 以下のときエラーをスロー', () => {
      expect(() => math.ewmaCorrelationMatrix(sampleData, 0)).toThrow();
      expect(() => math.ewmaCorrelationMatrix(sampleData, -5)).toThrow();
    });

    test('大きな halflife ではサンプル相関に収束する', () => {
      const C_sample = math.correlationMatrixSample(sampleData);
      const C_ewma_large = math.ewmaCorrelationMatrix(sampleData, 999);
      // 非常に大きな halflife ではほぼ等ウェイト → サンプル相関に近い
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(C_ewma_large[i][j]).toBeCloseTo(C_sample[i][j], 1);
        }
      }
    });
  });
});
