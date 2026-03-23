/**
 * 軽量ユニットテスト（CI 用・ネットワーク不要）
 */
'use strict';

const assert = require('assert');
const {
  correlationMatrix,
  eigenDecomposition,
  LeadLagSignal
} = require('../lib/lead_lag_core');
const { buildLeadLagMatrices } = require('../lib/lead_lag_matrices');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');

// 相関: 定数列は分散 0 でも例外にならない
{
  const data = [
    [1, 2],
    [1, 2],
    [1, 2]
  ];
  const c = correlationMatrix(data);
  assert.strictEqual(c.length, 2);
  assert.ok(Number.isFinite(c[0][0]));
}

// 対称行列の固有分解が有限値
{
  const A = [
    [2, 1],
    [1, 2]
  ];
  const { eigenvalues, eigenvectors } = eigenDecomposition(A, 2);
  assert.strictEqual(eigenvalues.length, 2);
  assert.ok(eigenvalues.every(Number.isFinite));
  assert.ok(eigenvectors.every(v => v.every(Number.isFinite)));
}

// OC マップ: 同一日の JP で OC と CC が一致しない（合成データ）
{
  const u = US_ETF_TICKERS.slice(0, 2);
  const j = JP_ETF_TICKERS.slice(0, 2);
  const us = {};
  const jp = {};
  for (const t of u) {
    us[t] = [
      { date: '2020-01-01', open: 1, close: 1 },
      { date: '2020-01-02', open: 1, close: 1 },
      { date: '2020-01-03', open: 1, close: 1.01 },
      { date: '2020-01-04', open: 1, close: 1.02 }
    ];
  }
  for (const t of j) {
    jp[t] = [
      { date: '2020-01-02', open: 10, close: 10 },
      { date: '2020-01-03', open: 10, close: 10.5 },
      { date: '2020-01-04', open: 10, close: 10.1 }
    ];
  }
  const { retJp, retJpOc } = buildLeadLagMatrices(us, jp, u, j);
  assert.ok(retJp.length > 0, '行列が空でないこと');
  const oc = retJpOc[retJpOc.length - 1].values;
  const cc = retJp[retJp.length - 1].values;
  assert.notDeepStrictEqual(oc, cc, 'OC と CC が同一になってはいけない');
}

// LeadLagSignal が有限ベクトルを返す（ラベル次元と列数を一致）
{
  const labels = {
    US_XLB: 'cyclical',
    US_XLC: 'neutral',
    'JP_1617.T': 'defensive',
    'JP_1618.T': 'cyclical'
  };
  const config = { windowLength: 2, nFactors: 2, lambdaReg: 0.5, warmupPeriod: 2 };
  const nUs = 2;
  const nJp = 2;
  const retUs = Array.from({ length: 3 }, () => Array.from({ length: nUs }, () => 0.01));
  const retJp = Array.from({ length: 3 }, () => Array.from({ length: nJp }, () => 0.01));
  const latest = Array.from({ length: nUs }, () => 0.01);
  const combined = retUs.map((r, i) => [...r, ...retJp[i]]);
  const CFull = correlationMatrix(combined);
  const gen = new LeadLagSignal(config);
  const sig = gen.compute(retUs, retJp, latest, labels, CFull);
  assert.strictEqual(sig.length, nJp);
  assert.ok(sig.every(Number.isFinite));
}

console.log('test_unit.js: OK');
