'use strict';

function isCsvDataMode(cfg) {
  return String(cfg.data?.mode || '').toLowerCase() === 'csv';
}

function isAlreadyFullYahooPath(cfg) {
  return String(cfg.data?.mode || '').toLowerCase() === 'yahoo' &&
    String(cfg.data?.usOhlcvProvider || 'yahoo').toLowerCase() === 'yahoo';
}

function configForYahooDataRecovery(cfg) {
  return {
    ...cfg,
    data: {
      ...cfg.data,
      mode: 'yahoo',
      usOhlcvProvider: 'yahoo'
    }
  };
}

module.exports = {
  isCsvDataMode,
  isAlreadyFullYahooPath,
  configForYahooDataRecovery
};
