/**
 * Alpha Vantage TIME_SERIES_DAILY（米国株・ETF）
 * 無料枠は 1 日のリクエスト数に厳しい制限があるため、
 * - 銘柄ごとの全履歴をディスクキャッシュ
 * - 日次呼び出し回数をローカルファイルでカウント（超過時は Yahoo にフォールバック可）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const logger = createLogger('AlphaVantage');

const AV_BASE = 'https://www.alphavantage.co/query';

/** 同一プロセス内でクォータ読み書き＋HTTP を直列化 */
let lockChain = Promise.resolve();

/** 無料枠は 1 秒に 1 回程度推奨 → 直列でも詰めると Note が返る */
let lastAvHttpAt = 0;
const AV_HTTP_GAP_MS = 1200;

function withLock(fn) {
  const run = lockChain.then(() => fn());
  lockChain = run.catch((err) => logger.debug('withLock: ignoring error to unblock queue', { error: err?.message })).then(() => {});
  return run;
}

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function cacheDir(appConfig) {
  const custom = String(appConfig?.data?.alphaVantageCacheDir || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(path.resolve(appConfig.data.dataDir), 'cache', 'alphavantage');
}

function dailyLimit(appConfig) {
  const n = appConfig?.data?.alphaVantageDailyMaxCalls;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}

function usagePath(appConfig) {
  return path.join(cacheDir(appConfig), '_daily_usage.json');
}

function symbolCachePath(appConfig, symbol) {
  const safe = String(symbol).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(cacheDir(appConfig), `${safe}.json`);
}

function readJsonFile(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(p, obj) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 0), 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * @returns {{ date: string, count: number }}
 */
function readUsage(appConfig) {
  const today = utcDateString();
  const raw = readJsonFile(usagePath(appConfig));
  if (!raw || raw.date !== today) {
    return { date: today, count: 0 };
  }
  return { date: today, count: Math.max(0, Number(raw.count) || 0) };
}

function incrementUsage(appConfig) {
  const p = usagePath(appConfig);
  const cur = readUsage(appConfig);
  cur.count += 1;
  writeJsonFile(p, cur);
}

/**
 * @param {Array<{date:string}>} bars
 */
function barDateRange(bars) {
  if (!bars || bars.length === 0) return { min: null, max: null };
  let min = bars[0].date;
  let max = bars[0].date;
  for (const b of bars) {
    if (b.date < min) min = b.date;
    if (b.date > max) max = b.date;
  }
  return { min, max };
}

/**
 * キャッシュが要求区間を包含するか（営業日欠けは別問題として許容）
 */
function cacheCoversRange(bars, startStr, endStr) {
  const { min, max } = barDateRange(bars);
  if (!min || !max) return false;
  return min <= startStr && max >= endStr;
}

function selectBarsInRange(bars, startStr, endStr) {
  return (bars || [])
    .filter((b) => b.date >= startStr && b.date <= endStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Alpha Vantage のレスポンスを正規化（昇順）
 */
function parseTimeSeriesDaily(json) {
  const series = json && json['Time Series (Daily)'];
  if (!series || typeof series !== 'object') {
    return { bars: [], error: 'NO_TIME_SERIES' };
  }
  const bars = [];
  for (const [d, ohlc] of Object.entries(series)) {
    const date = String(d).split('T')[0];
    const close = parseFloat(ohlc['4. close']);
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    const open = parseFloat(ohlc['1. open']);
    const high = parseFloat(ohlc['2. high']);
    const low = parseFloat(ohlc['3. low']);
    const volume = parseFloat(ohlc['5. volume']);
    bars.push({
      date,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume: Number.isFinite(volume) ? volume : 0
    });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return { bars, error: null };
}

function mergeBarsByDate(existing, incoming) {
  const map = new Map();
  for (const b of existing || []) {
    map.set(b.date, b);
  }
  for (const b of incoming || []) {
    map.set(b.date, b);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function readSymbolCache(appConfig, symbol) {
  const p = symbolCachePath(appConfig, symbol);
  const raw = readJsonFile(p);
  if (!raw || !Array.isArray(raw.bars)) return [];
  return raw.bars;
}

function writeSymbolCache(appConfig, symbol, bars) {
  const p = symbolCachePath(appConfig, symbol);
  writeJsonFile(p, {
    symbol,
    updatedAt: new Date().toISOString(),
    bars
  });
}

async function httpGetJson(url, timeoutMs) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, json: { message: text.slice(0, 200) } };
  }
  return { ok: res.ok, status: res.status, json };
}

async function pacedHttpGetJson(url, timeoutMs) {
  const now = Date.now();
  const wait = Math.max(0, lastAvHttpAt + AV_HTTP_GAP_MS - now);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  try {
    return await httpGetJson(url, timeoutMs);
  } finally {
    lastAvHttpAt = Date.now();
  }
}

/**
 * @param {'compact'|'full'} outputsize — 無料 API は compact（直近約100営業日）のみ
 * @returns {Promise<{ bars: Array, error: string|null, errorCode: string|null }>}
 */
async function fetchTimeSeriesDaily(symbol, apiKey, timeoutMs, outputsize) {
  const params = new URLSearchParams({
    function: 'TIME_SERIES_DAILY',
    symbol: String(symbol).trim(),
    outputsize,
    apikey: apiKey,
    datatype: 'json'
  });
  const url = `${AV_BASE}?${params.toString()}`;
  const { ok, status, json } = await pacedHttpGetJson(url, timeoutMs);

  if (!ok) {
    return {
      bars: [],
      error: `HTTP ${status}`,
      errorCode: 'AV_HTTP'
    };
  }

  if (json && json['Error Message']) {
    return {
      bars: [],
      error: String(json['Error Message']),
      errorCode: 'AV_ERROR_MESSAGE'
    };
  }
  if (json && (json.Note || json.Information)) {
    const msg = String(json.Note || json.Information);
    return { bars: [], error: msg, errorCode: 'AV_RATE_OR_INFO' };
  }

  const parsed = parseTimeSeriesDaily(json);
  if (parsed.error || parsed.bars.length === 0) {
    return {
      bars: [],
      error: parsed.error || 'empty series',
      errorCode: 'AV_EMPTY'
    };
  }

  return { bars: parsed.bars, error: null, errorCode: null };
}

function timeoutMsFromConfig(appConfig) {
  const t = appConfig?.yahooFinance?.timeout;
  return Number.isFinite(t) && t > 0 ? t : 30000;
}

/**
 * 米国ティッカー用: キャッシュ優先、不足時のみ API（1 銘柄 1 回で全履歴更新）
 *
 * @returns {Promise<{ data: Array, error: string|null, errorCode: string|null, useYahooFallback?: boolean }>}
 */
async function fetchUsDailyOhlcvCached(ticker, startStr, endStr, appConfig) {
  const apiKey = String(appConfig?.data?.alphaVantageApiKey || '').trim();
  if (!apiKey) {
    return {
      data: [],
      error: 'ALPHA_VANTAGE_NO_KEY',
      errorCode: 'NO_KEY',
      useYahooFallback: true
    };
  }

  const symbol = ticker.trim();
  const cached = readSymbolCache(appConfig, symbol);
  if (cacheCoversRange(cached, startStr, endStr)) {
    return {
      data: selectBarsInRange(cached, startStr, endStr),
      error: null,
      errorCode: null
    };
  }

  return withLock(async () => {
    const again = readSymbolCache(appConfig, symbol);
    if (cacheCoversRange(again, startStr, endStr)) {
      return {
        data: selectBarsInRange(again, startStr, endStr),
        error: null,
        errorCode: null
      };
    }

    const usage = readUsage(appConfig);
    const limit = dailyLimit(appConfig);
    if (usage.count >= limit) {
      logger.warn(
        'Alpha Vantage: 本日の API 上限に達しました。キャッシュが区間を満たさないため Yahoo にフォールバックします。',
        { symbol, count: usage.count, limit }
      );
      return {
        data: [],
        error: 'ALPHA_VANTAGE_DAILY_LIMIT',
        errorCode: 'QUOTA_EXCEEDED',
        useYahooFallback: true
      };
    }

    const t = timeoutMsFromConfig(appConfig);
    const outputsize =
      appConfig?.data?.alphaVantageOutputSize === 'full' ? 'full' : 'compact';
    let { bars, error, errorCode } = await fetchTimeSeriesDaily(symbol, apiKey, t, outputsize);
    if (
      errorCode === 'AV_RATE_OR_INFO' &&
      outputsize === 'full' &&
      /premium|outputsize/i.test(String(error))
    ) {
      logger.warn('Alpha Vantage: full が拒否されたため compact で再試行', { symbol });
      ({ bars, error, errorCode } = await fetchTimeSeriesDaily(symbol, apiKey, t, 'compact'));
    }
    if (error || !bars.length) {
      logger.warn('Alpha Vantage 取得に失敗', { symbol, error, errorCode });
      const fallback =
        errorCode === 'AV_RATE_OR_INFO' || errorCode === 'AV_EMPTY';
      return {
        data: [],
        error: error || 'AV_FAIL',
        errorCode: errorCode || 'UNKNOWN',
        useYahooFallback: fallback
      };
    }

    incrementUsage(appConfig);
    const merged = mergeBarsByDate(again, bars);
    writeSymbolCache(appConfig, symbol, merged);
    logger.info('Alpha Vantage キャッシュを更新', {
      symbol,
      bars: merged.length,
      usageAfter: readUsage(appConfig).count
    });

    if (!cacheCoversRange(merged, startStr, endStr)) {
      // compact は直近約100営業日のみ。部分スライスを返すと日米アライメント後の行数が窓を満たさず「データ不足」になりやすい
      const { min, max } = barDateRange(merged);
      logger.warn(
        'Alpha Vantage: 要求区間をカバーできません。Yahoo にフォールバックします。',
        { symbol, startStr, endStr, cacheMin: min, cacheMax: max }
      );
      return {
        data: [],
        error: `Insufficient history for ${startStr}..${endStr}`,
        errorCode: 'INSUFFICIENT_HISTORY',
        useYahooFallback: true
      };
    }

    return {
      data: selectBarsInRange(merged, startStr, endStr),
      error: null,
      errorCode: null
    };
  });
}

module.exports = {
  fetchUsDailyOhlcvCached,
  /** @internal tests */
  barDateRange,
  cacheCoversRange,
  selectBarsInRange,
  mergeBarsByDate,
  parseTimeSeriesDaily,
  readUsage,
  utcDateString
};
