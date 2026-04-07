'use strict';

const { config } = require('../../lib/config');
const {
  getUiConfigPayload,
  updateBacktestConfig,
  buildConfigUpdateSummary
} = require('../../src/server/modules/configStore');

describe('configStore', () => {
  test('getUiConfigPayload returns the current config snapshot', () => {
    const payload = getUiConfigPayload({
      disclosure: { short: 'x', lines: [] },
      dataSources: { autoManaged: true }
    });

    expect(payload.windowLength).toBe(config.backtest.windowLength);
    expect(payload.nFactors).toBe(config.backtest.nFactors);
    expect(payload.lambdaReg).toBe(config.backtest.lambdaReg);
    expect(payload.quantile).toBe(config.backtest.quantile);
    expect(payload.dataMode).toBe(config.data.mode);
    expect(payload.usOhlcvProvider).toBe(config.data.usOhlcvProvider);
  });

  test('updateBacktestConfig applies and returns changed fields', () => {
    const prev = {
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile
    };

    const applied = updateBacktestConfig({
      windowLength: prev.windowLength,
      lambdaReg: prev.lambdaReg,
      quantile: prev.quantile
    });

    expect(applied).toEqual({
      windowLength: prev.windowLength,
      lambdaReg: prev.lambdaReg,
      quantile: prev.quantile
    });

    expect(config.backtest.windowLength).toBe(prev.windowLength);
    expect(config.backtest.lambdaReg).toBe(prev.lambdaReg);
    expect(config.backtest.quantile).toBe(prev.quantile);
  });

  test('buildConfigUpdateSummary returns current config slices', () => {
    const summary = buildConfigUpdateSummary(config);
    expect(summary.backtest.windowLength).toBe(config.backtest.windowLength);
    expect(summary.backtest.lambdaReg).toBe(config.backtest.lambdaReg);
    expect(summary.backtest.quantile).toBe(config.backtest.quantile);
    expect(summary.data.mode).toBe(config.data.mode);
    expect(summary.data.usOhlcvProvider).toBe(config.data.usOhlcvProvider);
  });
});
