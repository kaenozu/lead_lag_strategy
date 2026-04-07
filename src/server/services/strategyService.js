'use strict';

const { DATA_MARGIN_DAYS, SIGNAL_MIN_WINDOW_DAYS } = require('../../lib/config');
const { createBacktestService } = require('./backtestService');
const { createSignalService } = require('./signalService');

function createStrategyService(deps) {
  const backtestService = createBacktestService({
    ...deps,
    dataMarginDays: DATA_MARGIN_DAYS
  });
  const signalService = createSignalService({
    ...deps,
    signalMinWindowDays: SIGNAL_MIN_WINDOW_DAYS
  });

  return {
    runBacktest: backtestService.run,
    generateSignal: signalService.run
  };
}

module.exports = {
  createStrategyService
};

