'use strict';

const { createLogger } = require('../logger');

const logger = createLogger('DataUtils');

async function fetchWithRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    shouldRetry = (error) => true
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!shouldRetry(error) || attempt === maxRetries) {
        logger.error('Operation failed after retries', {
          attempts: attempt + 1,
          error: error.message
        });
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
        error: error.message
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function fetchTickerOhlcv(ticker, days, appConfig) {
  const fs = require('fs');
  const path = require('path');

  if (appConfig.data.mode === 'csv') {
    const filePath = path.join(path.resolve(appConfig.data.dataDir), `${ticker}.csv`);
    if (!fs.existsSync(filePath)) {
      logger.error(`CSV not found: ${filePath}`);
      return { data: [], error: `CSV not found: ${filePath}`, errorCode: 'CSV_NOT_FOUND' };
    }
    try {
      const { loadCSV } = require('./csv');
      const rows = loadCSV(filePath).map(row => ({
        date: String(row.Date || row.date || '').split('T')[0],
        open: parseFloat(row.Open ?? row.open) || 0,
        high: parseFloat(row.High ?? row.high) || 0,
        low: parseFloat(row.Low ?? row.low) || 0,
        close: parseFloat(row.Close ?? row.close) || 0,
        volume: parseFloat(row.Volume ?? row.volume) || 0
      })).filter(r => r.date && Number.isFinite(r.close) && r.close > 0);
      const data = days > 0 && rows.length > days ? rows.slice(-days) : rows;
      if (data.length === 0) {
        return { data: [], error: `No valid data in ${filePath}`, errorCode: 'EMPTY_CSV' };
      }
      return { data, error: null, errorCode: null };
    } catch (error) {
      logger.error(`Failed to load ${ticker}`, { error: error.message });
      return { data: [], error: error.message, errorCode: 'CSV_LOAD_ERROR' };
    }
  }

  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await fetchWithRetry(
      () => yahooFinance.chart(ticker, {
        period1: startDate.toISOString().split('T')[0],
        period2: endDate.toISOString().split('T')[0],
        interval: '1d'
      }),
      { maxRetries: 3, baseDelay: 1000 }
    );

    if (!result || !result.quotes || result.quotes.length === 0) {
      const errMsg = `No data returned for ${ticker}`;
      logger.warn(errMsg);
      return { data: [], error: errMsg, errorCode: 'NO_DATA' };
    }

    const data = result.quotes
      .filter(q => q.close !== null && q.close > 0)
      .map(q => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume
      }));

    if (data.length === 0) {
      const errMsg = `All quotes filtered out for ${ticker}`;
      logger.warn(errMsg);
      return { data: [], error: errMsg, errorCode: 'FILTERED_OUT' };
    }

    return { data, error: null, errorCode: null };
  } catch (error) {
    const errorCode = error.message.includes('quota') ? 'RATE_LIMIT' :
                      error.message.includes('Not Found') ? 'NOT_FOUND' :
                      error.message.includes('network') ? 'NETWORK_ERROR' : 'UNKNOWN';
    logger.warn(`Failed to fetch ${ticker}`, { error: error.message, errorCode });
    return { data: [], error: error.message, errorCode };
  }
}

async function fetchOhlcvForTickers(tickers, days, appConfig) {
  const results = await Promise.all(
    tickers.map(t => fetchTickerOhlcv(t, days, appConfig))
  );
  const byTicker = {};
  const errors = {};
  tickers.forEach((t, i) => {
    byTicker[t] = results[i].data;
    if (results[i].error) errors[t] = results[i].error;
  });
  return { byTicker, errors };
}

module.exports = {
  fetchWithRetry,
  fetchTickerOhlcv,
  fetchOhlcvForTickers
};
