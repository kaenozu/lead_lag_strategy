'use strict';

const { JP_ETF_TICKERS } = require('../../lib/constants');

jest.mock('../../lib/config', () => ({
  config: {
    backtest: { windowLength: 60 },
    pca: { orderedSectorKeys: [] }
  }
}));

jest.mock('../../lib/pca', () => ({
  LeadLagSignal: jest.fn().mockImplementation(() => ({
    computeSignal: jest.fn((retUsWindow, retJpWindow, retUsLatest) => {
      const n = retJpWindow[0]?.length || retUsLatest.length || 1;
      return new Array(n).fill(0).map((_, i) => (i % 2 === 0 ? 0.2 : -0.2));
    })
  }))
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('../../lib/portfolio', () => ({
  computePerformanceMetrics: jest.fn((returns) => ({
    Cumulative: 1 + returns.reduce((sum, r) => sum + r, 0),
    RR: 1.0,
    MDD: 0.1
  }))
}));

const { DEFAULT_VOL_EXPOSURE } = require('../../lib/riskExposure');
const {
  runBacktestWithMarketRegime,
  computeUnifiedWarmup,
  BACKTEST_CONFIG
} = require('../../scripts/backtest_with_market_regime');

describe('scripts/backtest_with_market_regime', () => {
  test('warmup 修正後は十分な長さで実行ループが 0 件にならない', () => {
    const length = 260;
    const nJp = JP_ETF_TICKERS.length;

    const returnsUs = Array.from({ length }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      values: [0.001 + (i % 3) * 0.0002]
    }));

    const returnsJpOc = Array.from({ length }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      values: new Array(nJp).fill(0).map((_, j) => 0.0005 + ((i + j) % 5) * 0.0001)
    }));

    const params = {
      lambdaReg: 0.7,
      nFactors: 3,
      quantile: 0.4,
      dailyLossStop: 0,
      sectorFilterEnabled: true,
      sectorLookback: 60,
      sectorMinWinRate: 0,
      sectorMinReturn: -1,
      marketRegime: {
        lookback: 200,
        bullThreshold: 1.02,
        bearThreshold: 0.98,
        positionSizeBull: 1.0,
        positionSizeBear: 0.0,
        positionSizeNeutral: 0.5
      }
    };

    const windowLength = 60;
    const volLb = DEFAULT_VOL_EXPOSURE.lookback;
    const expectedWarmup = Math.max(
      windowLength,
      params.marketRegime.lookback,
      params.sectorLookback,
      volLb + 2
    );

    const result = runBacktestWithMarketRegime(
      returnsUs,
      returnsJpOc,
      params,
      [],
      []
    );

    expect(result.returns.length).toBeGreaterThan(0);
    expect(result.returns.length).toBe(length - expectedWarmup);
  });

  test('dailyLossStop 発動後も恒久停止せず再開する', () => {
    const length = 90;
    const nJp = JP_ETF_TICKERS.length;

    const returnsUs = Array.from({ length }, (_, i) => ({
      date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
      values: [0.001 + (i % 2) * 0.0001]
    }));

    const returnsJpOc = Array.from({ length }, (_, i) => {
      let base = 0.004;
      if (i === 60) {
        base = -0.2;
      }
      return {
        date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
        values: new Array(nJp).fill(base)
      };
    });

    const params = {
      lambdaReg: 0.5,
      nFactors: 2,
      quantile: 0.2,
      shortRatio: 0,
      dailyLossStop: 0.01,
      stopCooldownDays: 1,
      sectorFilterEnabled: false,
      sectorLookback: 60,
      sectorMinWinRate: 0,
      sectorMinReturn: -1,
      marketRegime: {
        lookback: 60,
        bullThreshold: 0,
        bearThreshold: -1,
        positionSizeBull: 1.0,
        positionSizeBear: 1.0,
        positionSizeNeutral: 1.0
      }
    };

    const result = runBacktestWithMarketRegime(
      returnsUs,
      returnsJpOc,
      params,
      [],
      []
    );

    const returns = result.returns.map(r => r.return);
    const firstStopIdx = returns.findIndex(r => r === -0.01);
    expect(firstStopIdx).toBeGreaterThanOrEqual(0);

    const remaining = returns.slice(firstStopIdx + 2);
    expect(remaining.some(r => r !== 0)).toBe(true);
  });

  test('computeUnifiedWarmup は window・レジーム・セクター・ボラ窓の最大を返す', () => {
    const w = computeUnifiedWarmup(60, BACKTEST_CONFIG);
    expect(w).toBe(Math.max(
      60,
      BACKTEST_CONFIG.marketRegime.lookback,
      BACKTEST_CONFIG.sectorLookback,
      BACKTEST_CONFIG.volExposure.lookback + 2
    ));
  });
});
