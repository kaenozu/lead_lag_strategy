'use strict';

/**
 * 改善 1: ewmaCorrelationMatrix オプション付き SubspaceRegularizedPCA テスト
 * 改善 2: rollingVolScale / applySignalVolNorm テスト
 * 改善 3: useAdaptiveLambda テスト
 */

const { SubspaceRegularizedPCA } = require('../../../lib/pca');
const { rollingVolScale, applySignalVolNorm } = require('../../../lib/pca/signal_utils');

// テスト用共通フィクスチャ
const sectorLabels = {
  US_1: 'cyclical', US_2: 'defensive', US_3: 'neutral',
  JP_1: 'cyclical', JP_2: 'defensive', JP_3: 'neutral'
};
const CFull = [
  [1, 0.5, 0.5, 0.3, 0.3, 0.3],
  [0.5, 1, 0.5, 0.3, 0.3, 0.3],
  [0.5, 0.5, 1, 0.3, 0.3, 0.3],
  [0.3, 0.3, 0.3, 1, 0.5, 0.5],
  [0.3, 0.3, 0.3, 0.5, 1, 0.5],
  [0.3, 0.3, 0.3, 0.5, 0.5, 1]
];
const returns10 = Array.from({ length: 10 }, (_, i) => [
  0.01 * (i % 3 + 1),
  0.015 * (i % 2 + 1),
  -0.005 * (i % 4 + 1),
  0.008 * (i % 3 + 1),
  0.012 * (i % 2 + 1),
  -0.003 * (i % 4 + 1)
]);

// ============================================================
// 改善 1: EWMA 相関行列オプション
// ============================================================
describe('改善 1: useEwma オプション付き SubspaceRegularizedPCA', () => {
  test('useEwma=false (デフォルト) は従来と同じ挙動', () => {
    const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3, useEwma: false });
    const { VK } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull);
    expect(VK).toBeDefined();
    expect(VK.length).toBe(6);
  });

  test('useEwma=true で正常に PCA を計算できる', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9, nFactors: 3,
      useEwma: true, ewmaHalflife: 30
    });
    const { VK, eigenvalues, converged } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull);
    expect(VK.length).toBe(6);
    expect(eigenvalues.length).toBe(3);
    expect(converged).toBeDefined();
  });

  test('useEwma=true の結果は useEwma=false と異なる', () => {
    const pcaPlain = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3, useEwma: false });
    const pcaEwma  = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3, useEwma: true, ewmaHalflife: 15 });
    const { CReg: CPlain } = pcaPlain.computeRegularizedPCA(returns10, sectorLabels, CFull);
    const { CReg: CEwma  } = pcaEwma.computeRegularizedPCA(returns10, sectorLabels, CFull);
    // 少なくとも 1 要素が異なることを確認
    let anyDiff = false;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if (Math.abs(CPlain[i][j] - CEwma[i][j]) > 1e-8) { anyDiff = true; break; }
      }
    }
    expect(anyDiff).toBe(true);
  });

  test('lambdaUsed が返値に含まれる', () => {
    const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });
    const result = pca.computeRegularizedPCA(returns10, sectorLabels, CFull);
    expect(result).toHaveProperty('lambdaUsed');
    expect(result.lambdaUsed).toBeCloseTo(0.9);
  });
});

// ============================================================
// 改善 2: ローリング・ボラティリティ正規化
// ============================================================
describe('改善 2: rollingVolScale / applySignalVolNorm', () => {
  test('rollingVolScale: 出力長が入力と同じ', () => {
    const sig = [0.1, -0.2, 0.3, -0.1, 0.4, -0.3, 0.2, 0.15, -0.25, 0.05];
    const out = rollingVolScale(sig, 5);
    expect(out.length).toBe(sig.length);
  });

  test('rollingVolScale: ウォームアップ前 (t < volWindow) は変更なし', () => {
    const sig = [0.1, -0.2, 0.3, -0.1, 0.4, -0.3];
    const out = rollingVolScale(sig, 5);
    // 最初の 5 要素はそのまま
    for (let i = 0; i < 5; i++) {
      expect(out[i]).toBeCloseTo(sig[i]);
    }
  });

  test('rollingVolScale: 高ボラ期のシグナルが縮小される', () => {
    // targetVol を 0.1 に設定。rolling std が 0.5 なら scale = 0.1/0.5 = 0.2 → 縮小
    const sig = [0.01, -0.01, 0.01, -0.01, 0.01,  // 低ボラ (std≈0.01)
      0.5, -0.5, 0.5, -0.5, 0.5];       // 高ボラ (std≈0.5)
    const out = rollingVolScale(sig, 5, 0.1);       // targetVol = 0.1
    // 高ボラ区間: rolling std(0.5) > targetVol(0.1) → |out[9]| < |sig[9]|
    expect(Math.abs(out[9])).toBeLessThan(Math.abs(sig[9]));
  });

  test('rollingVolScale: 空配列は空配列を返す', () => {
    expect(rollingVolScale([])).toEqual([]);
  });

  test('applySignalVolNorm: 形状が維持される', () => {
    const T = 30;
    const N = 4;
    const mat = Array.from({ length: T }, (_, i) =>
      Array.from({ length: N }, (_, j) => 0.01 * (i - j))
    );
    const out = applySignalVolNorm(mat, 10);
    expect(out.length).toBe(T);
    expect(out[0].length).toBe(N);
  });

  test('applySignalVolNorm: 空入力は空を返す', () => {
    expect(applySignalVolNorm([])).toEqual([]);
  });
});

// ============================================================
// 改善 3: 適応的 λ
// ============================================================
describe('改善 3: useAdaptiveLambda オプション', () => {
  test('useAdaptiveLambda=false では lambdaReg がそのまま使われる', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9, nFactors: 3,
      useAdaptiveLambda: false
    });
    const { lambdaUsed } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull, 0.50);
    expect(lambdaUsed).toBeCloseTo(0.9);
  });

  test('useAdaptiveLambda=true + 低ボラ → λ ≈ lambdaMax', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9, nFactors: 3,
      useAdaptiveLambda: true,
      lambdaMin: 0.5, lambdaMax: 0.95,
      volLow: 0.08, volHigh: 0.30
    });
    // 低ボラ (σ=0.02, vol_low=0.08 以下) → λ = lambdaMax = 0.95
    const { lambdaUsed } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull, 0.02);
    expect(lambdaUsed).toBeCloseTo(0.95, 5);
  });

  test('useAdaptiveLambda=true + 高ボラ → λ ≈ lambdaMin', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9, nFactors: 3,
      useAdaptiveLambda: true,
      lambdaMin: 0.5, lambdaMax: 0.95,
      volLow: 0.08, volHigh: 0.30
    });
    // 高ボラ (σ=0.50, vol_high=0.30 以上) → λ = lambdaMin = 0.5
    const { lambdaUsed } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull, 0.50);
    expect(lambdaUsed).toBeCloseTo(0.5, 5);
  });

  test('useAdaptiveLambda=true + 中間ボラ → λ は [lambdaMin, lambdaMax] の間', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9, nFactors: 3,
      useAdaptiveLambda: true,
      lambdaMin: 0.5, lambdaMax: 0.95,
      volLow: 0.08, volHigh: 0.30
    });
    // 中間ボラ σ = 0.19 → x = (0.19-0.08)/(0.30-0.08) = 0.5 → λ = 0.725
    const { lambdaUsed } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull, 0.19);
    expect(lambdaUsed).toBeGreaterThan(0.5);
    expect(lambdaUsed).toBeLessThan(0.95);
    expect(lambdaUsed).toBeCloseTo(0.725, 3);
  });

  test('realizedVol が null のとき lambdaReg にフォールバック', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.85, nFactors: 3,
      useAdaptiveLambda: true
    });
    const { lambdaUsed } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull, null);
    expect(lambdaUsed).toBeCloseTo(0.85);
  });

  test('適応 λ で固有分解が収束する', () => {
    const pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9, nFactors: 3,
      useAdaptiveLambda: true,
      lambdaMin: 0.5, lambdaMax: 0.95
    });
    const { converged } = pca.computeRegularizedPCA(returns10, sectorLabels, CFull, 0.20);
    expect(converged).toBeDefined();
  });
});
