/**
 * backtest_real.js のバックテスト収益計算ロジックのテスト
 *
 * 検証内容：
 * - runBacktest / runMomentumStrategy が始値-終値（OC）リターン（returnsJpOc）を
 *   使用してポートフォリオ収益を計算していること
 * - 終値-終値（CC）リターン（returnsJp[i]）を誤って使用していないこと
 *
 * 背景：t-1 のシグナルで取引する場合、t の始値で取引し t の始値-終値（OC）リターンを
 * 収益とするのがルックアヘッドバイアスを避けるための正しいアプローチ。
 */

'use strict';

const { runBacktest, runMomentumStrategy } = require('../backtest/real');

// ============================================================================
// テスト用データ生成ヘルパー
// ============================================================================

/**
 * 全日同一値の日次リターン配列を生成する
 * @param {number} nDays 日数
 * @param {number[]} valuesPerDay 各資産のリターン値
 * @returns {{ date: string, values: number[] }[]}
 */
function makeReturns(nDays, valuesPerDay) {
  return Array.from({ length: nDays }, (_, i) => ({
    date: `2020-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    values: valuesPerDay.slice()
  }));
}

// ============================================================================
// runMomentumStrategy テスト
// ============================================================================

describe('runMomentumStrategy - OC リターン使用の検証', () => {
  const nDays = 130;
  const window = 60;
  const quantile = 0.3;

  // 過去の CC リターン：最初の 2 資産を強くロング、後ろ 2 資産を強くショートするモメンタム信号を作る
  // signal[k] = average(returnsJp[j].values[k]) for j in [i-window, i)
  const ccReturnsForSignal = [+0.05, +0.05, -0.05, -0.05];
  const returnsJp = makeReturns(nDays, ccReturnsForSignal);

  test('OC リターン（returnsJpOc）でポートフォリオ収益を計算すること', () => {
    // OC リターン：ロング対象（資産 0,1）を +10%、ショート対象（資産 2,3）を -10%
    // quantile=0.3, n=4 → q=1 → 1 資産ロング＋1 資産ショート
    // expected return ≈ 1 * 0.10 + (-1) * (-0.10) = 0.20
    const ocValues = [+0.10, +0.10, -0.10, -0.10];
    const returnsJpOc = makeReturns(nDays, ocValues);

    const result = runMomentumStrategy(returnsJp, returnsJpOc, window, quantile, 0);

    expect(result.returns.length).toBeGreaterThan(0);
    const meanReturn = result.returns.reduce((s, r) => s + r.return, 0) / result.returns.length;
    // OC リターンを使えば各日 ~0.20 のリターンとなるはず
    expect(meanReturn).toBeCloseTo(0.20, 1);
  });

  test('OC と CC が異なる場合、OC リターンの大きさを反映した収益になること', () => {
    // 大きな OC リターン（0.10）
    const returnsJpOcLarge = makeReturns(nDays, [+0.10, +0.10, -0.10, -0.10]);
    // 小さな OC リターン（0.02）
    const returnsJpOcSmall = makeReturns(nDays, [+0.02, +0.02, -0.02, -0.02]);

    const resultLarge = runMomentumStrategy(returnsJp, returnsJpOcLarge, window, quantile, 0);
    const resultSmall = runMomentumStrategy(returnsJp, returnsJpOcSmall, window, quantile, 0);

    const sumLarge = resultLarge.returns.reduce((s, r) => s + r.return, 0);
    const sumSmall = resultSmall.returns.reduce((s, r) => s + r.return, 0);

    // 大きな OC リターンの方が総収益も大きいはず（OC リターンが正しく参照されている証拠）
    expect(Math.abs(sumLarge)).toBeGreaterThan(Math.abs(sumSmall));
  });
});

// ============================================================================
// runBacktest テスト（EQUAL_WEIGHT 戦略）
// ============================================================================

describe('runBacktest - OC リターン使用の検証', () => {
  const nDays = 130;
  const nUs = 2;
  const nJp = 4;
  const warmupPeriod = 60;
  const windowLength = 60;

  const returnsUs = makeReturns(nDays, [0.001, 0.001]);
  // EQUAL_WEIGHT は nJp=4 → long=[0,1], short=[2,3]
  // シグナル計算に使用される CC リターン（戦略収益には使わない）
  const returnsJp = makeReturns(nDays, [0.001, 0.001, 0.001, 0.001]);

  const sectorLabels = {
    US_0: 'cyclical', US_1: 'defensive',
    JP_0: 'cyclical', JP_1: 'defensive', JP_2: 'neutral', JP_3: 'cyclical'
  };
  const CFull = Array.from({ length: nUs + nJp }, (_, i) =>
    Array.from({ length: nUs + nJp }, (_, j) => (i === j ? 1 : 0.3))
  );
  const config = {
    warmupPeriod,
    windowLength,
    quantile: 0.3,
    lambdaReg: 0.9,
    nFactors: 2,
    transactionCosts: 0,
    orderedSectorKeys: ['US_0', 'US_1', 'JP_0', 'JP_1', 'JP_2', 'JP_3']
  };

  test('OC リターン（returnsJpOc）でポートフォリオ収益を計算すること（EQUAL_WEIGHT）', () => {
    // EQUAL_WEIGHT: weights = [+0.5, +0.5, -0.5, -0.5]
    // OC リターン: ロング対象(0,1)が +0.10、ショート対象(2,3)が -0.10
    // expected = 0.5*0.10 + 0.5*0.10 + (-0.5)*(-0.10) + (-0.5)*(-0.10) = 0.20
    const returnsJpOc = makeReturns(nDays, [+0.10, +0.10, -0.10, -0.10]);

    const result = runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull, 'EQUAL_WEIGHT');

    expect(result.returns.length).toBeGreaterThan(0);
    const meanReturn = result.returns.reduce((s, r) => s + r.return, 0) / result.returns.length;
    // OC リターンを使えば各日 ~0.20 のリターンとなるはず
    expect(meanReturn).toBeCloseTo(0.20, 1);
  });

  test('OC と CC が異なる場合、OC リターンの大きさを反映した収益になること（EQUAL_WEIGHT）', () => {
    const returnsJpOcLarge = makeReturns(nDays, [+0.10, +0.10, -0.10, -0.10]);
    const returnsJpOcSmall = makeReturns(nDays, [+0.02, +0.02, -0.02, -0.02]);

    const resultLarge = runBacktest(returnsUs, returnsJp, returnsJpOcLarge, config, sectorLabels, CFull, 'EQUAL_WEIGHT');
    const resultSmall = runBacktest(returnsUs, returnsJp, returnsJpOcSmall, config, sectorLabels, CFull, 'EQUAL_WEIGHT');

    const sumLarge = resultLarge.returns.reduce((s, r) => s + r.return, 0);
    const sumSmall = resultSmall.returns.reduce((s, r) => s + r.return, 0);

    // 大きな OC リターンの方が総収益も大きいはず（OC リターンが正しく参照されている証拠）
    expect(Math.abs(sumLarge)).toBeGreaterThan(Math.abs(sumSmall));
  });

  test('ターンオーバー制限超過時も、前日ウェイトで日次損益は継続計上されること', () => {
    const returnsJpOc = makeReturns(nDays, [+0.10, +0.10, -0.10, -0.10]);
    const strictTurnoverConfig = {
      ...config,
      signalStability: {
        smoothingAlpha: 1,
        maxTurnoverPerDay: 0.000001
      }
    };

    const result = runBacktest(
      returnsUs,
      returnsJp,
      returnsJpOc,
      strictTurnoverConfig,
      sectorLabels,
      CFull,
      'EQUAL_WEIGHT'
    );

    // 初日の約定後、以降のリバランスは抑制されても日次損益は計上されるべき
    expect(result.returns.length).toBe(nDays - warmupPeriod);
    const meanReturn = result.returns.reduce((s, r) => s + r.return, 0) / result.returns.length;
    expect(meanReturn).toBeCloseTo(0.20, 1);
  });
});
