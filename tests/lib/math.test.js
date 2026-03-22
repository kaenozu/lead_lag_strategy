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

    test('サンプル数が少なすぎる場合エラー', () => {
      expect(() => math.correlationMatrix([[1, 2]])).toThrow('Need at least 2 samples');
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

  describe('validateVector', () => {
    test('有効なベクトル', () => {
      expect(() => math.validateVector([1, 2, 3])).not.toThrow();
    });

    test('空ベクトルでエラー', () => {
      expect(() => math.validateVector([])).toThrow('Invalid vector');
    });

    test('null でエラー', () => {
      expect(() => math.validateVector(null)).toThrow('Invalid vector');
    });

    test('NaN を含むベクトルでエラー', () => {
      expect(() => math.validateVector([1, NaN, 3])).toThrow('Invalid number');
    });
  });

  describe('dotProduct', () => {
    test('基本的な内積', () => {
      expect(math.dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
    });

    test('次元不一致でエラー', () => {
      expect(() => math.dotProduct([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
  });

  describe('transpose', () => {
    test('2x3 行列の転置', () => {
      const m = [[1, 2, 3], [4, 5, 6]];
      const t = math.transpose(m);
      expect(t.length).toBe(3);
      expect(t[0]).toEqual([1, 4]);
    });
  });

  describe('matmul', () => {
    test('次元不一致でエラー', () => {
      expect(() => math.matmul([[1, 2]], [[1, 2]])).toThrow('dimensions mismatch');
    });
  });

  describe('elementWiseMultiply', () => {
    test('要素ごとの積', () => {
      expect(math.elementWiseMultiply([2, 3, 4], [5, 6, 7])).toEqual([10, 18, 28]);
    });

    test('次元不一致でエラー', () => {
      expect(() => math.elementWiseMultiply([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
  });

  describe('scalarMultiply', () => {
    test('スカラー倍', () => {
      expect(math.scalarMultiply([1, 2, 3], 3)).toEqual([3, 6, 9]);
    });

    test('0 倍はゼロベクトル', () => {
      expect(math.scalarMultiply([1, 2, 3], 0)).toEqual([0, 0, 0]);
    });
  });

  describe('vectorAdd', () => {
    test('ベクトルの加算', () => {
      expect(math.vectorAdd([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    });

    test('次元不一致でエラー', () => {
      expect(() => math.vectorAdd([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
  });

  describe('vectorSubtract', () => {
    test('ベクトルの減算', () => {
      expect(math.vectorSubtract([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
    });

    test('次元不一致でエラー', () => {
      expect(() => math.vectorSubtract([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
  });

  describe('mean', () => {
    test('ベクトルの平均', () => {
      expect(math.mean([1, 2, 3, 4, 5])).toBeCloseTo(3);
    });

    test('単一要素', () => {
      expect(math.mean([42])).toBe(42);
    });
  });

  describe('std', () => {
    test('既知の標準偏差', () => {
      // 不偏標準偏差 (ddof=1): Math.sqrt(sum_sq / (n-1))
      // [2, 4, 4, 4, 5, 5, 7, 9]: mean=5, sum_sq = 9+1+1+1+0+0+4+16 = 32, std = sqrt(32/7)
      const expected = Math.sqrt(32 / 7);
      expect(math.std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(expected, 5);
    });

    test('2 要素未満でエラー', () => {
      expect(() => math.std([1])).toThrow('at least 2 elements');
    });
  });

  describe('copyMatrix', () => {
    test('行列をディープコピー', () => {
      const original = [[1, 2], [3, 4]];
      const copy = math.copyMatrix(original);
      copy[0][0] = 99;
      expect(original[0][0]).toBe(1); // 元のデータは不変
      expect(copy[0][0]).toBe(99);
    });
  });

  describe('validateMatrix - 追加ケース', () => {
    test('列数 0 でエラー', () => {
      expect(() => math.validateMatrix([[]])).toThrow('no columns');
    });

    test('NaN を含む行列でエラー', () => {
      expect(() => math.validateMatrix([[1, NaN]])).toThrow('Invalid number');
    });
  });

  describe('eigenDecomposition - 追加ケース', () => {
    test('非正方行列でエラー', () => {
      expect(() => math.eigenDecomposition([[1, 2, 3], [4, 5, 6]])).toThrow('square');
    });

    test('k が n を超える場合は n に制限', () => {
      const matrix = [[2, 1], [1, 2]];
      const { eigenvalues } = math.eigenDecomposition(matrix, 10);
      expect(eigenvalues.length).toBe(2); // n=2 に制限
    });
  });
});
