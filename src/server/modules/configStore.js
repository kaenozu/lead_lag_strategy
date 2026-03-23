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
  if (partial.windowLength !== undefined) {
    config.backtest.windowLength = partial.windowLength;
  }
  if (partial.lambdaReg !== undefined) {
    config.backtest.lambdaReg = partial.lambdaReg;
  }
  if (partial.quantile !== undefined) {
    config.backtest.quantile = partial.quantile;
  }
}

module.exports = {
  getUiConfigPayload,
  updateBacktestConfig
};

