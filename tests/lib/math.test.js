/**
 * lib/math.js のテスト
 */

'use strict';

const math = require('../../lib/math');

describe('lib/math', () => {
  describe('transpose', () => {
    test('2x3行列を転置', () => {
      const matrix = [
        [1, 2, 3],
        [4, 5, 6]
      ];
      const result = math.transpose(matrix);
      expect(result).toEqual([
        [1, 4],
        [2, 5],
        [3, 6]
      ]);
    });

    test('空行列でエラーをスロー', () => {
      expect(() => math.transpose([])).toThrow('Invalid matrix');
    });
  });

  describe('matmul', () => {
    test('2x2行列の積', () => {
      const A = [
        [1, 2],
        [3, 4]
      ];
      const B = [
        [5, 6],
        [7, 8]
      ];
      const result = math.matmul(A, B);
      expect(result[0][0]).toBeCloseTo(19);
      expect(result[0][1]).toBeCloseTo(22);
      expect(result[1][0]).toBeCloseTo(43);
      expect(result[1][1]).toBeCloseTo(50);
    });

    test('次元不一致でエラーをスロー', () => {
      const A = [[1, 2]];
      const B = [[1], [2], [3]];
      expect(() => math.matmul(A, B)).toThrow('Matrix dimensions mismatch');
    });
  });

  describe('dotProduct', () => {
    test('ベクトルの内積', () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      expect(math.dotProduct(a, b)).toBe(32);
    });

    test('次元不一致でエラーをスロー', () => {
      expect(() => math.dotProduct([1, 2], [1, 2, 3])).toThrow('Vector dimension mismatch');
    });
  });

  describe('norm', () => {
    test('ベクトルのノルム', () => {
      const v = [3, 4];
      expect(math.norm(v)).toBe(5);
    });

    test('空ベクトルでエラーをスロー', () => {
      expect(() => math.norm([])).toThrow('Invalid vector');
    });
  });

  describe('normalize', () => {
    test('ベクトルの正規化', () => {
      const v = [3, 4];
      const result = math.normalize(v);
      expect(result[0]).toBeCloseTo(0.6);
      expect(result[1]).toBeCloseTo(0.8);
    });

    test('ゼロベクトルでエラーをスロー', () => {
      expect(() => math.normalize([0, 0])).toThrow('Cannot normalize zero vector');
    });
  });

  describe('diag', () => {
    test('対角要素を取得', () => {
      const matrix = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ];
      expect(math.diag(matrix)).toEqual([1, 5, 9]);
    });
  });

  describe('makeDiag', () => {
    test('対角行列を作成', () => {
      const v = [1, 2, 3];
      const result = math.makeDiag(v);
      expect(result).toEqual([
        [1, 0, 0],
        [0, 2, 0],
        [0, 0, 3]
      ]);
    });
  });

  describe('eigenDecomposition', () => {
    test('対称行列の固有値分解', () => {
      const matrix = [
        [2, 1],
        [1, 2]
      ];
      const { eigenvalues, eigenvectors } = math.eigenDecomposition(matrix, 2);
      expect(eigenvalues.length).toBe(2);
      expect(eigenvectors.length).toBe(2);
    });

    test('kパラメータで取得数を制限', () => {
      const matrix = [
        [2, 1, 0.5],
        [1, 2, 1],
        [0.5, 1, 2]
      ];
      const { eigenvalues } = math.eigenDecomposition(matrix, 2);
      expect(eigenvalues.length).toBe(2);
    });
  });

  describe('correlationMatrix', () => {
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
      expect(result[1][0]).toBeCloseTo(1);
    });

    test('空データでエラーをスロー', () => {
      expect(() => math.correlationMatrix([])).toThrow('Invalid data');
    });
  });

  describe('mean', () => {
    test('ベクトルの平均', () => {
      expect(math.mean([1, 2, 3, 4, 5])).toBe(3);
    });
  });

  describe('std', () => {
    test('ベクトルの標準偏差', () => {
      const result = math.std([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.14);
    });
  });
});
