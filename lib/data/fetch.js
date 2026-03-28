'use strict';

const { createLogger } = require('../logger');
const { mergeOhlcvByDate, fetchJQuantsOhlcvRange } = require('./jquants');

const logger = createLogger('DataUtils');

async function fetchWithRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    shouldRetry = (_error) => true
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

/**
 * Yahoo Finance chart（指定期間）
 */
async function fetchYahooChart(ticker, period1Str, period2Str) {
  const YahooFinance = require('yahoo-finance2').default;
  const yahooFinance = new YahooFinance();
  const result = await fetchWithRetry(
    () =>
      yahooFinance.chart(ticker, {
        period1: period1Str,
        period2: period2Str,
        interval: '1d'
      }),
    {
      maxRetries: 5,
      baseDelay: 2000,
      shouldRetry: () => true
    }
  );

  if (!result || !result.quotes || result.quotes.length === 0) {
    return [];
  }

  return result.quotes
    .filter((q) => q.close !== null && q.close > 0 && q.date != null)
    .map((q) => ({
      date: q.date.toISOString().split('T')[0],
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume
    }));
}

/**
 * 米国銘柄: Alpha Vantage（キャッシュ＋日次上限）または Yahoo
 */
async function fetchUsOhlcvWindow(ticker, startStr, endStr, appConfig) {
  const usp = String(appConfig?.data?.usOhlcvProvider || '').toLowerCase();
  if (usp === 'stooq') {
    const { fetchStooqOhlcvWindow } = require('./stooq');
    return fetchStooqOhlcvWindow(ticker, startStr, endStr);
  }

  const strictMode = Boolean(appConfig?.data?.strictSourceMode);
  const useAv =
    String(appConfig?.data?.usOhlcvProvider || '').toLowerCase() === 'alphavantage' &&
    Boolean(String(appConfig?.data?.alphaVantageApiKey || '').trim());

  if (useAv) {
    const { fetchUsDailyOhlcvCached } = require('./alphavantage');
    const r = await fetchUsDailyOhlcvCached(ticker, startStr, endStr, appConfig);
    if (r.data && r.data.length > 0) {
      return { data: r.data, error: null, errorCode: null, sourcePath: 'us:alphavantage' };
    }
    if (r.useYahooFallback) {
      if (strictMode) {
        return {
          data: [],
          error: r.error || 'Alpha Vantage unavailable (strict mode)',
          errorCode: r.errorCode || 'STRICT_SOURCE_BLOCK',
          sourcePath: 'us:alphavantage_strict_block'
        };
      }
      logger.warn('US: Alpha Vantage から取得できず Yahoo にフォールバック', {
        ticker,
        error: r.error
      });
      const y = await fetchYahooOhlcvWindow(ticker, startStr, endStr);
      return { ...y, sourcePath: 'us:alphavantage->yahoo' };
    }
    return {
      data: [],
      error: r.error || 'No US data',
      errorCode: r.errorCode || 'NO_DATA',
      sourcePath: 'us:alphavantage_error'
    };
  }

  const y = await fetchYahooOhlcvWindow(ticker, startStr, endStr);
  return { ...y, sourcePath: 'us:yahoo' };
}

async function fetchYahooOhlcvWindow(ticker, startStr, endStr) {
  try {
    const data = await fetchYahooChart(ticker, startStr, endStr);
    if (data.length === 0) {
      return {
        data: [],
        error: `No data returned for ${ticker}`,
        errorCode: 'NO_DATA'
      };
    }
    return { data, error: null, errorCode: null };
  } catch (error) {
    const errorCode =
      error.message.includes('quota') || error.message.includes('rate limit')
        ? 'RATE_LIMIT'
        : error.message.includes('Not Found')
          ? 'NOT_FOUND'
          : error.message.includes('network')
            ? 'NETWORK_ERROR'
            : 'UNKNOWN';

    if (errorCode === 'RATE_LIMIT') {
      logger.error(`Rate limit exceeded for ${ticker}.`, {
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
 * @param {string} ticker
 * @param {number} days - asOf から遡るカレンダー日近似
 * @param {object} appConfig
 * @param {object} [opts]
 * @param {Date} [opts.asOf] - 窓の終端日（既定: 今日）
 */
async function fetchTickerOhlcv(ticker, days, appConfig, opts = {}) {
  const fs = require('fs');
  const path = require('path');

  const asOf =
    opts.asOf instanceof Date && !Number.isNaN(opts.asOf.getTime()) ? opts.asOf : new Date();
  const endStr = asOf.toISOString().split('T')[0];
  const winStart = new Date(asOf);
  winStart.setDate(winStart.getDate() - days);
  const startStr = winStart.toISOString().split('T')[0];

  if (appConfig.data.mode === 'csv') {
    const filePath = path.join(path.resolve(appConfig.data.dataDir), `${ticker}.csv`);
    if (!fs.existsSync(filePath)) {
      logger.error(`CSV not found: ${filePath}`);
      return {
        data: [],
        error: `CSV not found: ${filePath}`,
        errorCode: 'CSV_NOT_FOUND',
        sourcePath: ticker.endsWith('.T') ? 'jp:csv' : 'us:csv'
      };
    }
    try {
      const { loadCSV } = require('./csv');
      const rows = loadCSV(filePath)
        .map((row) => ({
          date: String(row.Date || row.date || '').split('T')[0],
          open: parseFloat(row.Open ?? row.open) || 0,
          high: parseFloat(row.High ?? row.high) || 0,
          low: parseFloat(row.Low ?? row.low) || 0,
          close: parseFloat(row.Close ?? row.close) || 0,
          volume: parseFloat(row.Volume ?? row.volume) || 0
        }))
        .filter((r) => r.date && Number.isFinite(r.close) && r.close > 0);
      // CSV はローカル履歴ファイル想定。asOf による日付窓はかけず末尾 days 件のみ（従来どおり）
      const data = days > 0 && rows.length > days ? rows.slice(-days) : rows;
      if (data.length === 0) {
        return {
          data: [],
          error: `No valid data in ${filePath}`,
          errorCode: 'EMPTY_CSV',
          sourcePath: ticker.endsWith('.T') ? 'jp:csv' : 'us:csv'
        };
      }
      return {
        data,
        error: null,
        errorCode: null,
        sourcePath: ticker.endsWith('.T') ? 'jp:csv' : 'us:csv'
      };
    } catch (error) {
      logger.error(`Failed to load ${ticker}`, { error: error.message });
      return {
        data: [],
        error: error.message,
        errorCode: 'CSV_LOAD_ERROR',
        sourcePath: ticker.endsWith('.T') ? 'jp:csv' : 'us:csv'
      };
    }
  }

  if (appConfig.data.mode === 'stooq') {
    if (!ticker.endsWith('.T')) {
      return fetchUsOhlcvWindow(ticker, startStr, endStr, appConfig);
    }
    const { fetchStooqOhlcvWindow } = require('./stooq');
    return fetchStooqOhlcvWindow(ticker, startStr, endStr);
  }

  if (appConfig.data.mode === 'yahoo') {
    if (!ticker.endsWith('.T')) {
      return fetchUsOhlcvWindow(ticker, startStr, endStr, appConfig);
    }
    const res = await fetchYahooOhlcvWindow(ticker, startStr, endStr);
    return { ...res, sourcePath: 'jp:yahoo' };
  }

  if (appConfig.data.mode === 'jquants') {
    // 米国 ETF は J-Quants 対象外 → Alpha Vantage または Yahoo
    if (!ticker.endsWith('.T')) {
      return fetchUsOhlcvWindow(ticker, startStr, endStr, appConfig);
    }

    const weeks = appConfig.data.jquantsRecentWeeksYahoo ?? 12;
    const cutoff = new Date(asOf);
    cutoff.setDate(cutoff.getDate() - weeks * 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const dayBefore = new Date(cutoff);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const histEndStr = dayBefore.toISOString().split('T')[0];

    if (startStr > cutoffStr) {
      const y = await fetchYahooOhlcvWindow(ticker, startStr, endStr);
      return { ...y, sourcePath: 'jp:yahoo_short_window' };
    }

    let historical = [];
    if (startStr <= histEndStr) {
      const jq = await fetchJQuantsOhlcvRange(ticker, startStr, histEndStr, appConfig);
      historical = jq.data || [];
      // 認証失敗・未設定は履歴ゼロのまま Yahoo 短期分だけだと窓日数が足りないため、全期間を Yahoo で取り直す
      const err = jq.error;
      const needFallback =
        !historical.length &&
        err &&
        err !== 'JQUANTS_PAYLOAD_TOO_LARGE' &&
        (err === 'JQUANTS_NOT_IMPLEMENTED' ||
          err === 'JQUANTS_NO_CREDENTIALS' ||
          err === 'NO_JQUANTS_CODE' ||
          err === 'JQUANTS_UNAUTHORIZED' ||
          (typeof err === 'string' && err.startsWith('JQUANTS_AUTH_')));
      if (needFallback) {
        if (appConfig?.data?.strictSourceMode) {
          return {
            data: [],
            error: err || 'J-Quants unavailable (strict mode)',
            errorCode: 'STRICT_SOURCE_BLOCK',
            sourcePath: 'jp:jquants_strict_block'
          };
        }
        const y = await fetchYahooOhlcvWindow(ticker, startStr, endStr);
        return { ...y, sourcePath: 'jp:jquants_error->yahoo' };
      }
    }

    const recent = await fetchYahooChart(ticker, cutoffStr, endStr);
    const merged = mergeOhlcvByDate(historical, recent);
    const filtered = merged.filter((r) => r.date >= startStr && r.date <= endStr);

    if (filtered.length === 0) {
      return {
        data: [],
        error: `No merged data for ${ticker}`,
        errorCode: 'NO_DATA'
      };
    }
    return { data: filtered, error: null, errorCode: null, sourcePath: 'jp:jquants+recent_yahoo' };
  }

  logger.warn(`Unknown BACKTEST_DATA_MODE=${appConfig.data.mode}, using Yahoo`);
  if (!ticker.endsWith('.T')) {
    return fetchUsOhlcvWindow(ticker, startStr, endStr, appConfig);
  }
  const y = await fetchYahooOhlcvWindow(ticker, startStr, endStr);
  return { ...y, sourcePath: 'unknown_mode->yahoo' };
}

/**
 * 明示開始日・終了日（バックテスト CLI 用）
 */
async function fetchTickerOhlcvRange(ticker, startDateStr, endDateStr, appConfig) {
  const end = new Date(`${endDateStr}T12:00:00`);
  const start = new Date(`${startDateStr}T12:00:00`);
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) {
    return { data: [], error: 'Invalid date range', errorCode: 'BAD_DATE' };
  }
  const days = Math.max(1, Math.ceil((end - start) / 86400000) + 15);
  const res = await fetchTickerOhlcv(ticker, days, appConfig, { asOf: end });
  const filtered = (res.data || []).filter(
    (r) => r.date >= startDateStr && r.date <= endDateStr
  );
  return { ...res, data: filtered };
}

async function fetchOhlcvDateRangeForTickers(tickers, startDateStr, endDateStr, appConfig) {
  const results = await Promise.allSettled(
    tickers.map((t) => fetchTickerOhlcvRange(t, startDateStr, endDateStr, appConfig))
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
      byTicker[t] = [];
    }
  });

  const errorCount = Object.keys(errors).length;
  if (errorCount > 0) {
    logger.warn(`Fetch completed with ${errorCount}/${tickers.length} errors`, {
      errors: Object.keys(errors)
    });
  }

  return { byTicker, errors };
}

/**
 * @param {string[]} tickers
 * @param {number} days
 * @param {Object} appConfig
 * @param {object} [opts] - fetchTickerOhlcv にそのまま渡す（asOf など）
 */
async function fetchOhlcvForTickers(tickers, days, appConfig, opts = {}) {
  const results = await Promise.allSettled(
    tickers.map((t) => fetchTickerOhlcv(t, days, appConfig, opts))
  );

  const byTicker = {};
  const errors = {};
  const sources = {};

  tickers.forEach((t, i) => {
    const result = results[i];

    if (result.status === 'fulfilled' && result.value.data) {
      byTicker[t] = result.value.data;
      sources[t] = result.value.sourcePath || 'unknown';
      if (result.value.error) {
        errors[t] = result.value.error;
      }
    } else if (result.status === 'rejected') {
      errors[t] = result.reason?.message || 'Unknown error';
      logger.error(`Failed to fetch ${t}: ${errors[t]}`);
      sources[t] = 'rejected';
    }
  });

  const errorCount = Object.keys(errors).length;
  if (errorCount > 0) {
    logger.warn(`Fetch completed with ${errorCount}/${tickers.length} errors`, {
      errors: Object.keys(errors)
    });
  }

  return { byTicker, errors, sources };
}

module.exports = {
  fetchWithRetry,
  fetchYahooChart,
  fetchUsOhlcvWindow,
  fetchTickerOhlcv,
  fetchTickerOhlcvRange,
  fetchOhlcvDateRangeForTickers,
  fetchOhlcvForTickers
};
