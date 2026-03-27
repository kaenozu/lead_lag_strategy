'use strict';

const { config } = require('../../../lib/config');

function getUiConfigPayload({ disclosure, dataSources }) {
  return {
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    dataMode: config.data.mode,
    usOhlcvProvider: config.data.usOhlcvProvider,
    disclosure,
    dataSources
  };
}

function updateBacktestConfig(partial = {}) {
  const applied = {};
  if (partial.windowLength !== undefined) {
    config.backtest.windowLength = partial.windowLength;
    applied.windowLength = partial.windowLength;
  }
  if (partial.lambdaReg !== undefined) {
    config.backtest.lambdaReg = partial.lambdaReg;
    applied.lambdaReg = partial.lambdaReg;
  }
  if (partial.quantile !== undefined) {
    config.backtest.quantile = partial.quantile;
    applied.quantile = partial.quantile;
  }
  return applied;
}

function buildConfigUpdateSummary(config) {
  return {
    backtest: {
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile
    },
    data: {
      mode: config.data.mode,
      usOhlcvProvider: config.data.usOhlcvProvider
    }
  };
}

module.exports = {
  getUiConfigPayload,
  updateBacktestConfig,
  buildConfigUpdateSummary
};
