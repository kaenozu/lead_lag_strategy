'use strict';

const { fetchOhlcvForTickers } = require('./index');

/**
 * データプロバイダ取得の薄いアダプタ層。
 * 将来的に provider 単位の実装差し替えをここに集約する。
 */
async function fetchMarketDataForTickers(tickers, calendarDays, runtimeConfig) {
  return fetchOhlcvForTickers(tickers, calendarDays, runtimeConfig);
}

module.exports = {
  fetchMarketDataForTickers
};

