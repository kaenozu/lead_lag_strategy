'use strict';

/**
 * Stooq 日足（無料・HTTPS）
 * https://stooq.com/q/d/l/?s=SYMBOL&i=d&d1=YYYYMMDD&d2=YYYYMMDD
 *
 * 日本 ETF: 1618.T → 1618.jp
 * 米国 ETF: XLB → xlb.us
 *
 * 利用は Stooq の利用規約・レートに従ってください。大量・短間隔の自動取得は避けてください。
 */

const { fetch: undiciFetch } = require('undici');
const { createLogger } = require('../logger');
const { parseCSV } = require('./csv');

const logger = createLogger('Stooq');

function tickerToStooqSymbol(ticker) {
  const t = String(ticker || '').trim();
  if (!t) return '';
  if (t.endsWith('.T')) {
    const n = t.slice(0, -2);
    return `${n}.jp`;
  }
  return `${t.toLowerCase()}.us`;
}

function ymdCompact(isoDateStr) {
  return String(isoDateStr || '').replace(/-/g, '').slice(0, 8);
}

/**
 * @param {string} ticker - 1618.T / XLB
 * @param {string} startStr - YYYY-MM-DD
 * @param {string} endStr - YYYY-MM-DD
 * @returns {Promise<{ data: object[], error: string|null, errorCode: string|null, sourcePath?: string }>}
 */
async function fetchStooqOhlcvWindow(ticker, startStr, endStr) {
  const sym = tickerToStooqSymbol(ticker);
  const regionTag = String(ticker || '').trim().endsWith('.T') ? 'jp' : 'us';
  const okPath = `${regionTag}:stooq`;
  const tag = (suffix) => (suffix ? `${regionTag}:stooq_${suffix}` : okPath);

  if (!sym) {
    return { data: [], error: 'empty ticker', errorCode: 'BAD_TICKER', sourcePath: tag('bad_ticker') };
  }
  const d1 = ymdCompact(startStr) || '19900101';
  const d2 = ymdCompact(endStr) || '20991231';
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d&d1=${d1}&d2=${d2}`;

  try {
    const res = await undiciFetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; lead-lag-strategy/1.0; +https://github.com/kaenozu/lead_lag_strategy)'
      }
    });
    if (!res.ok) {
      return {
        data: [],
        error: `Stooq HTTP ${res.status}`,
        errorCode: 'STOOQ_HTTP',
        sourcePath: tag('http_error')
      };
    }
    const text = await res.text();
    if (!text || text.includes('<!DOCTYPE') || text.includes('<html')) {
      return {
        data: [],
        error: 'Stooq returned non-CSV (symbol 未登録・レート制限の可能性)',
        errorCode: 'STOOQ_HTML',
        sourcePath: tag('html')
      };
    }

    const rows = parseCSV(text.trim());
    const data = rows
      .map((row) => ({
        date: String(row.Date || row.date || '').split('T')[0],
        open: parseFloat(row.Open ?? row.open) || 0,
        high: parseFloat(row.High ?? row.high) || 0,
        low: parseFloat(row.Low ?? row.low) || 0,
        close: parseFloat(row.Close ?? row.close) || 0,
        volume: parseFloat(row.Volume ?? row.volume) || 0
      }))
      .filter((r) => r.date && Number.isFinite(r.close) && r.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (data.length === 0) {
      return {
        data: [],
        error: `No rows for ${ticker} (${sym})`,
        errorCode: 'NO_DATA',
        sourcePath: tag('empty')
      };
    }

    return { data, error: null, errorCode: null, sourcePath: okPath };
  } catch (e) {
    logger.warn('Stooq fetch failed', { ticker, sym, error: e.message });
    return {
      data: [],
      error: e.message,
      errorCode: 'STOOQ_ERROR',
      sourcePath: tag('error')
    };
  }
}

module.exports = {
  tickerToStooqSymbol,
  fetchStooqOhlcvWindow
};
