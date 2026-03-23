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

    // レート制限エラーへの対応：リトライ回数と遅延時間を増加
    const result = await fetchWithRetry(
      () => yahooFinance.chart(ticker, {
        period1: startDate.toISOString().split('T')[0],
        period2: endDate.toISOString().split('T')[0],
        interval: '1d'
      }),
      { 
        maxRetries: 5,  // 3 → 5 に増加
        baseDelay: 2000,  // 1000ms → 2000ms に増加
        shouldRetry: (error) => {
          // レート制限エラーは必ずリトライ
          if (error.message.includes('quota') || error.message.includes('rate limit')) {
            logger.info(`Rate limit hit for ${ticker}, will retry`);
            return true;
          }
          // その他のエラーもリトライ
          return true;
        }
      }
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
    const errorCode = error.message.includes('quota') || error.message.includes('rate limit') ? 'RATE_LIMIT' :
      error.message.includes('Not Found') ? 'NOT_FOUND' :
        error.message.includes('network') ? 'NETWORK_ERROR' : 'UNKNOWN';
    
    // レート制限エラーは詳細ログ
    if (errorCode === 'RATE_LIMIT') {
      logger.error(`Rate limit exceeded for ${ticker}. Consider reducing request frequency.`, {
        error: error.message,
        errorCode
      });
    } else {
      logger.warn(`Failed to fetch ${ticker}`, { error: error.message, errorCode });
    }
    
    return { data: [], error: error.message, errorCode };
  }
}

/**
 * 複数銘柄の OHLCV データを取得（並列・個別エラー処理）
 * @param {string[]} tickers - 銘柄リスト
 * @param {number} days - 取得日数
 * @param {Object} appConfig - 設定
 * @returns {Promise<{byTicker: Object, errors: Object}>}
 */
async function fetchOhlcvForTickers(tickers, days, appConfig) {
  // Promise.allSettled を使用して、個別のエラーを記録
  const results = await Promise.allSettled(
    tickers.map(t => fetchTickerOhlcv(t, days, appConfig))
  );
  
  const byTicker = {};
  const errors = {};
  
  tickers.forEach((t, i) => {
    const result = results[i];
    
    if (result.status === 'fulfilled' && result.value.data) {
      byTicker[t] = result.value.data;
      if (result.value.error) {
        errors[t] = result.value.error;
      }
    } else if (result.status === 'rejected') {
      errors[t] = result.reason?.message || 'Unknown error';
      logger.error(`Failed to fetch ${t}: ${errors[t]}`);
    }
  });
  
  // エラーがある場合は警告
  const errorCount = Object.keys(errors).length;
  if (errorCount > 0) {
    logger.warn(`Fetch completed with ${errorCount}/${tickers.length} errors`, { 
      errors: Object.keys(errors) 
    });
  }
  
  return { byTicker, errors };
}

module.exports = {
  fetchWithRetry,
  fetchTickerOhlcv,
  fetchOhlcvForTickers
};
