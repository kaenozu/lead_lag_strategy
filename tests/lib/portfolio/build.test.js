'use strict';

const {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio
} = require('../../../lib/portfolio');

describe('lib/portfolio/build', () => {
  describe('buildPortfolio', () => {
    test('基本的なポートフォリオ構築', () => {
      const signal = [0.5, -0.3, 0.8, -0.1, 0.2, 0.9, -0.4, 0.1];
      const weights = buildPortfolio(signal, 0.25);

      expect(weights.length).toBe(8);

      const positiveCount = weights.filter(w => w > 0).length;
      const negativeCount = weights.filter(w => w < 0).length;

      expect(positiveCount).toBe(2);
      expect(negativeCount).toBe(2);
    });

    test('quantile=0.3で上位30%がロング、下位30%がショート', () => {
      const signal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const weights = buildPortfolio(signal, 0.3);

      const longWeight = weights.filter(w => w > 0).reduce((a, b) => a + b, 0);
      const shortWeight = weights.filter(w => w < 0).reduce((a, b) => a + b, 0);

      expect(longWeight).toBeCloseTo(1);
      expect(shortWeight).toBeCloseTo(-1);
    });

    test('デフォルトquantileは0.3', () => {
      const signal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const weights = buildPortfolio(signal);

      const longWeight = weights.filter(w => w > 0).reduce((a, b) => a + b, 0);
      const shortWeight = weights.filter(w => w < 0).reduce((a, b) => a + b, 0);

      expect(longWeight).toBeCloseTo(1);
      expect(shortWeight).toBeCloseTo(-1);
    });

    test('空シグナルでエラーをスロー', () => {
      expect(() => buildPortfolio([], 0.3)).toThrow('Invalid signal');
    });

    test('nullシグナルでエラーをスロー', () => {
      expect(() => buildPortfolio(null, 0.3)).toThrow('Invalid signal');
    });

    test('undefinedシグナルでエラーをスロー', () => {
      expect(() => buildPortfolio(undefined, 0.3)).toThrow('Invalid signal');
    });

    test('quantile=0でエラーをスロー', () => {
      expect(() => buildPortfolio([1, 2, 3], 0)).toThrow('Invalid quantile');
    });

    test('quantile=0.5は有効', () => {
      const signal = [1, 2, 3];
      const weights = buildPortfolio(signal, 0.5);
      expect(weights.length).toBe(3);
    });

    test('quantile=0.51でエラーをスロー', () => {
      expect(() => buildPortfolio([1, 2, 3], 0.51)).toThrow('Invalid quantile');
    });

    test('quantile<0でエラーをスロー', () => {
      expect(() => buildPortfolio([1, 2, 3], -0.1)).toThrow('Invalid quantile');
    });

    test('タイブレーク時にインデックス順でソート', () => {
      const signal = [1, 1, 1, 2, 2, 2];
      const weights = buildPortfolio(signal, 0.33);

      const positiveIndices = weights.map((w, i) => w > 0 ? i : -1).filter(i => i >= 0);
      expect(positiveIndices.length).toBeGreaterThan(0);
    });

    test('単一要素でquantile適用', () => {
      expect(() => buildPortfolio([1], 0.3)).toThrow('Invalid signal: all values are identical');
    });

    test('全員が同じシグナル値の場合', () => {
      expect(() => buildPortfolio([1, 1, 1, 1], 0.25)).toThrow('Invalid signal: all values are identical');
    });

    test('負の値を含むシグナル', () => {
      const signal = [-0.5, 0.3, 0.8, -0.9, 0.1, -0.2];
      const weights = buildPortfolio(signal, 0.33);

      const maxWeight = Math.max(...weights);
      const minWeight = Math.min(...weights);

      expect(maxWeight).toBe(1);
      expect(minWeight).toBe(-1);
    });
  });

  describe('buildDoubleSortPortfolio', () => {
    test('ダブルソートポートフォリオ構築', () => {
      const momSignal = [0.1, 0.2, 0.3, 0.4, 0.5];
      const pcaSignal = [0.5, 0.4, 0.3, 0.2, 0.1];
      const weights = buildDoubleSortPortfolio(momSignal, pcaSignal, 0.2);

      expect(weights.length).toBe(5);
    });

    test('デフォルトquantileは0.3', () => {
      const momSignal = [0.1, 0.2, 0.3, 0.4, 0.5];
      const pcaSignal = [0.5, 0.4, 0.3, 0.2, 0.1];
      const weights = buildDoubleSortPortfolio(momSignal, pcaSignal);

      expect(weights.length).toBe(5);
    });

    test('次元不一致でエラーをスロー', () => {
      expect(() =>
        buildDoubleSortPortfolio([1, 2, 3], [1, 2], 0.3)
      ).toThrow('Signal dimension mismatch');
    });

    test('nullシグナルでエラーをスロー', () => {
      expect(() =>
        buildDoubleSortPortfolio(null, [1, 2, 3], 0.3)
      ).toThrow('Invalid input');
    });

    test('undefinedシグナルでエラーをスロー', () => {
      expect(() =>
        buildDoubleSortPortfolio([1, 2, 3], undefined, 0.3)
      ).toThrow('Invalid input');
    });

    test('等しいシグナルで重み付け', () => {
      const momSignal = [1, 1, 1, 1, 1];
      const pcaSignal = [1, 1, 1, 1, 1];
      expect(() => buildDoubleSortPortfolio(momSignal, pcaSignal, 0.4)).toThrow('Invalid input: all signal values are identical');
    });

    test('単一要素のシグナル', () => {
      const momSignal = [1];
      const pcaSignal = [1];
      expect(() => buildDoubleSortPortfolio(momSignal, pcaSignal, 0.3)).toThrow('Invalid input: all signal values are identical');
    });

    test('完全に逆方向のシグナル', () => {
      const momSignal = [1, 2, 3, 4, 5];
      const pcaSignal = [5, 4, 3, 2, 1];
      const weights = buildDoubleSortPortfolio(momSignal, pcaSignal, 0.2);

      expect(weights.length).toBe(5);
    });

    test('単一要素のシグナル (double sort)', () => {
      const momSignal = [1];
      const pcaSignal = [1];
      expect(() => buildDoubleSortPortfolio(momSignal, pcaSignal, 0.3)).toThrow('Invalid input: all signal values are identical');
    });
  });

  describe('buildEqualWeightPortfolio', () => {
    test('基本的な等ウェイトポートフォリオ', () => {
      const weights = buildEqualWeightPortfolio(5, [0, 1], [2, 3]);

      expect(weights[0]).toBe(0.5);
      expect(weights[1]).toBe(0.5);
      expect(weights[2]).toBe(-0.5);
      expect(weights[3]).toBe(-0.5);
      expect(weights[4]).toBe(0);
    });

    test('単一ロング・ショート', () => {
      const weights = buildEqualWeightPortfolio(3, [0], [1]);

      expect(weights[0]).toBe(1);
      expect(weights[1]).toBe(-1);
      expect(weights[2]).toBe(0);
    });

    test('nが0でエラーをスロー', () => {
      expect(() => buildEqualWeightPortfolio(0, [0], [1])).toThrow('Invalid n');
    });

    test('nが負でエラーをスロー', () => {
      expect(() => buildEqualWeightPortfolio(-1, [0], [1])).toThrow('Invalid n');
    });

    test('空のlongIndicesでエラーをスロー', () => {
      expect(() => buildEqualWeightPortfolio(3, [], [1])).toThrow('Invalid longIndices');
    });

    test('nullのlongIndicesでエラーをスロー', () => {
      expect(() => buildEqualWeightPortfolio(3, null, [1])).toThrow('Invalid longIndices');
    });

    test('undefinedのlongIndicesでエラーをスロー', () => {
      expect(() => buildEqualWeightPortfolio(3, undefined, [1])).toThrow('Invalid longIndices');
    });

    test('大きなnで動作', () => {
      const longIndices = Array.from({ length: 100 }, (_, i) => i);
      const weights = buildEqualWeightPortfolio(200, longIndices, []);

      expect(weights[0]).toBe(0.01);
      expect(weights[99]).toBe(0.01);
    });

    test('shortIndices undefinedでエラー', () => {
      expect(() => buildEqualWeightPortfolio(3, [0, 1], undefined)).toThrow();
    });
  });
  describe('エッジケース（buildPortfolio）', () => {
    test('空のシグナルは空の配列を返す', () => {
      const weights = buildPortfolio([], 0.3);
      expect(weights).toEqual([]);
    });

    test('null シグナルは空の配列を返す', () => {
      const weights = buildPortfolio(null, 0.3);
      expect(weights).toEqual([]);
    });

    test('全シグナルが同一の場合はニュートラル（ゼロウェイト）', () => {
      const weights = buildPortfolio([1, 1, 1, 1], 0.3);
      expect(weights).toEqual([0, 0, 0, 0]);
    });

    test('全シグナルがゼロの場合はニュートラル', () => {
      const weights = buildPortfolio([0, 0, 0, 0], 0.3);
      expect(weights).toEqual([0, 0, 0, 0]);
    });

    test('極小値のシグナルはニュートラル', () => {
      const weights = buildPortfolio([1e-12, 2e-12, 1e-12], 0.3);
      expect(weights).toEqual([0, 0, 0]);
    });

    test('無効な quantile はデフォルト 0.3 を使用', () => {
      const signal = [0.1, 0.2, 0.3, 0.4, 0.5];
      const weights1 = buildPortfolio(signal, -0.1);
      const weights2 = buildPortfolio(signal, 0.6);
      
      // デフォルト 0.3 が使用される
      expect(weights1.length).toBe(5);
      expect(weights2.length).toBe(5);
    });
  });
});
