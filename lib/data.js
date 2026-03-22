/**
 * データ処理ユーティリティ
 * Data Processing Utilities
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const logger = createLogger('DataUtils');

/**
 * リトライ付き非同期処理実行（指数バックオフ）
 * @param {Function} fn - 実行する非同期関数
 * @param {Object} options - オプション
 * @param {number} options.maxRetries - 最大リトライ回数（デフォルト：3）
 * @param {number} options.baseDelay - 基本遅延時間 ms（デフォルト：1000）
 * @param {Function} options.shouldRetry - リトライ判定関数（オプション）
 * @returns {Promise<*>} 関数の戻り値
 */
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

      // リトライ不要なエラーまたは最終試行
      if (!shouldRetry(error) || attempt === maxRetries) {
        logger.error('Operation failed after retries', {
          attempts: attempt + 1,
          error: error.message
        });
        throw error;
      }

      // 指数バックオフ：1 秒、2 秒、4 秒...
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
 * 各日本営業日 jpDate に対し、データ上「直前」の米国営業日 usDate を 1 本に対応づける（論文・Python 手続きに合わせた JP 主導アライメント）
 * usDates / jpDates は取引カレンダー上の営業日のみを渡す想定（休場日は系列に含まれない）
 * @param {Array<string>} usDates - 米国の観測日（YYYY-MM-DD、昇順でなくても可）
 * @param {Array<string>} jpDates - 日本の観測日
 * @returns {Array<{usDate: string, jpDate: string}>}
 */
function alignDates(usDates, jpDates) {
  if (!usDates || usDates.length === 0 || !jpDates || jpDates.length === 0) {
    return [];
  }

  const usSorted = [...usDates].sort();
  const jpSorted = [...jpDates].sort();
  const aligned = [];

  for (const jpDate of jpSorted) {
    const usDate = lastUsDateStrictlyBefore(usSorted, jpDate);
    if (usDate !== null) {
      aligned.push({ usDate, jpDate });
    }
  }

  return aligned;
}

/**
 * @param {Array<string>} usSortedAsc - 昇順ソート済み米国日付
 * @param {string} jpDate
 * @returns {string|null}
 */
function lastUsDateStrictlyBefore(usSortedAsc, jpDate) {
  let lo = 0;
  let hi = usSortedAsc.length - 1;
  let ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (usSortedAsc[mid] < jpDate) {
      ans = usSortedAsc[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * 旧実装：米国連続営業日 i と i-1 のペアのうち、同日が日本も開いている日のみ採用
 * @deprecated 再現用に残置。新規コードは {@link alignDates} を使用
 */
function alignDatesLegacy(usDates, jpDates, options = {}) {
  const { lagDays = 1 } = options;

  if (!usDates || usDates.length === 0 || !jpDates || jpDates.length === 0) {
    return [];
  }

  const jpDateSet = new Set(jpDates);
  const aligned = [];

  for (let i = lagDays; i < usDates.length; i++) {
    const usDate = usDates[i - lagDays];
    const jpDate = usDates[i];

    if (jpDateSet.has(jpDate)) {
      aligned.push({ usDate, jpDate });
    }
  }

  return aligned;
}

/**
 * 米・日マップから論文アライメント済みリターン行を構築
 * @param {Map<string, Object<string, number>>} usMap - 日付 → { ticker: ccReturn }
 * @param {Map<string, Object<string, number>>} jpCCMap
 * @param {Map<string, Object<string, number>>} jpOCMap
 * @param {string[]} usTickers
 * @param {string[]} jpTickers
 * @param {'cc'|'oc'} jpWindowReturn - 推定窓内の日本側リターン
 */
function buildPaperAlignedReturnRows(usMap, jpCCMap, jpOCMap, usTickers, jpTickers, jpWindowReturn = 'cc') {
  const usDates = [...usMap.keys()].sort();
  const jpDates = [...jpCCMap.keys()].sort();
  const alignedDates = alignDates(usDates, jpDates);
  const jpWinMap = jpWindowReturn === 'oc' ? jpOCMap : jpCCMap;

  const retUs = [];
  const retJp = [];
  const retJpOc = [];
  const dates = [];

  for (const { usDate, jpDate } of alignedDates) {
    const usRow = usTickers.map(t => usMap.get(usDate)?.[t]);
    const jpRow = jpTickers.map(t => jpWinMap.get(jpDate)?.[t]);
    const jpOcRow = jpTickers.map(t => jpOCMap.get(jpDate)?.[t]);

    if (usRow.some(v => v === undefined) ||
        jpRow.some(v => v === undefined) ||
        jpOcRow.some(v => v === undefined)) {
      continue;
    }

    retUs.push({ date: usDate, values: usRow });
    retJp.push({ date: jpDate, values: jpRow });
    retJpOc.push({ date: jpDate, values: jpOcRow });
    dates.push(jpDate);
  }

  return { retUs, retJp, retJpOc, dates };
}

/**
 * CSV データをパース
 */
function parseCSV(csvText) {
  try {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have at least a header and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length !== headers.length) {
        logger.warn(`Skipping row ${i}: column count mismatch`);
        continue;
      }

      const row = {};
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        const val = values[j]?.trim();
        const numVal = parseFloat(val);
        row[key] = isNaN(numVal) ? val : numVal;
      }
      data.push(row);
    }

    return data;
  } catch (error) {
    logger.error('Failed to parse CSV', { error: error.message });
    throw error;
  }
}

/**
 * CSV ファイルを読み込み
 */
function loadCSV(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return parseCSV(content);
  } catch (error) {
    logger.error('Failed to load CSV', { filePath, error: error.message });
    throw error;
  }
}

/**
 * データを CSV として保存
 */
function saveCSV(filePath, data, headers = null) {
  try {
    if (!data || data.length === 0) {
      throw new Error('No data to save');
    }

    const cols = headers || Object.keys(data[0]);
    const lines = [cols.join(',')];

    for (const row of data) {
      const values = cols.map(col => {
        const val = row[col];
        return val !== undefined && val !== null ? String(val) : '';
      });
      lines.push(values.join(','));
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    logger.info('CSV saved successfully', { filePath, rows: data.length });
  } catch (error) {
    logger.error('Failed to save CSV', { filePath, error: error.message });
    throw error;
  }
}

/**
 * OHLCV データから Close-to-Close リターンを計算
 */
function computeCCReturns(ohlcv) {
  if (!ohlcv || ohlcv.length < 2) {
    throw new Error('Need at least 2 data points to compute returns');
  }

  const returns = [];
  let prevClose = null;

  for (const row of ohlcv) {
    const close = parseFloat(row.close);
    if (isNaN(close) || close <= 0) {
      logger.warn(`Invalid close price for date ${row.date}`);
      continue;
    }

    if (prevClose !== null && prevClose > 0) {
      returns.push({
        date: row.date,
        return: (close - prevClose) / prevClose
      });
    }
    prevClose = close;
  }

  return returns;
}

/**
 * OHLCV データから Open-to-Close リターンを計算
 */
function computeOCReturns(ohlcv) {
  if (!ohlcv || ohlcv.length === 0) {
    throw new Error('No data to compute returns');
  }

  const returns = [];

  for (const row of ohlcv) {
    const open = parseFloat(row.open);
    const close = parseFloat(row.close);

    if (isNaN(open) || isNaN(close) || open <= 0) {
      logger.warn(`Invalid price data for date ${row.date}`);
      continue;
    }

    returns.push({
      date: row.date,
      return: (close - open) / open
    });
  }

  return returns;
}

/**
 * 複数銘柄のリターンを行列として構築
 */
function buildReturnMatrix(returnsMap) {
  const tickers = Object.keys(returnsMap);
  if (tickers.length === 0) {
    throw new Error('No return data provided');
  }

  // 日付の集合を構築
  const dateSet = new Set();
  for (const ticker of tickers) {
    for (const r of returnsMap[ticker]) {
      dateSet.add(r.date);
    }
  }
  const dates = Array.from(dateSet).sort();

  // 日付→インデックスのマップ
  const dateIndex = new Map();
  dates.forEach((date, i) => dateIndex.set(date, i));

  // 行列を構築（欠損値は前方充填）
  const matrix = [];
  for (const ticker of tickers) {
    const row = new Array(dates.length).fill(null);
    for (const r of returnsMap[ticker]) {
      const idx = dateIndex.get(r.date);
      if (idx !== undefined) {
        row[idx] = r.return;
      }
    }
    // 欠損値を前方充填
    const filledRow = fillForward(row);
    matrix.push(filledRow);
  }

  return {
    dates,
    matrix: transpose(matrix),
    tickers
  };
}

/**
 * 行列の転置
 */
function transpose(matrix) {
  if (!matrix || matrix.length === 0) {
    throw new Error('Invalid matrix: matrix is empty or null');
  }
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

/**
 * 欠損値を補間（前方充填）
 * @param {Array<number|null>} arr - 入力配列
 * @returns {Array<number>} 補間後の配列
 */
function fillForward(arr) {
  const result = [];
  let lastValid = null;

  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    if (val !== null && val !== undefined && !isNaN(val)) {
      lastValid = val;
      result.push(val);
    } else if (lastValid !== null) {
      result.push(lastValid);
    } else {
      // 最初の値が欠損の場合は 0 で埋める
      result.push(0);
    }
  }

  return result;
}

/**
 * 欠損値を後方充填
 * @param {Array<number|null>} arr - 入力配列
 * @returns {Array<number>} 補間後の配列
 */
function fillBackward(arr) {
  const result = new Array(arr.length);
  let nextValid = null;

  for (let i = arr.length - 1; i >= 0; i--) {
    const val = arr[i];
    if (val !== null && val !== undefined && !isNaN(val)) {
      nextValid = val;
      result[i] = val;
    } else if (nextValid !== null) {
      result[i] = nextValid;
    } else {
      result[i] = 0;
    }
  }

  return result;
}

/**
 * 線形補間
 * @param {Array<number|null>} arr - 入力配列
 * @returns {Array<number>} 補間後の配列
 */
function fillLinear(arr) {
  const result = [...arr];
  let lastValidIdx = null;

  for (let i = 0; i < result.length; i++) {
    const val = result[i];
    if (val !== null && val !== undefined && !isNaN(val)) {
      if (lastValidIdx !== null && i - lastValidIdx > 1) {
        // 間の欠損値を線形補間
        const startVal = result[lastValidIdx];
        const endVal = val;
        const steps = i - lastValidIdx;
        for (let j = 1; j < steps; j++) {
          result[lastValidIdx + j] = startVal + (endVal - startVal) * (j / steps);
        }
      }
      lastValidIdx = i;
    }
  }

  // 端数の処理
  if (lastValidIdx !== null) {
    // 最初の欠損値は前方充填
    for (let i = 0; i < lastValidIdx; i++) {
      if (result[i] === null || result[i] === undefined || isNaN(result[i])) {
        result[i] = result[lastValidIdx];
      }
    }
    // 最後の欠損値は後方充填
    for (let i = lastValidIdx + 1; i < result.length; i++) {
      if (result[i] === null || result[i] === undefined || isNaN(result[i])) {
        result[i] = result[lastValidIdx];
      }
    }
  }

  return result;
}

/**
 * 欠損値を削除したデータを返す
 */
function dropNA(data, key) {
  return data.filter(row => {
    const val = row[key];
    return val !== null && val !== undefined && !isNaN(val);
  });
}

/**
 * 祝日・市場休業日をチェック
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {string} market - 'US' or 'JP'
 * @returns {boolean} 営業日の場合 true
 */
function isTradingDay(date, market = 'JP') {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  const dayOfMonth = d.getDate();
  const month = d.getMonth() + 1;

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  if (market === 'US') {
    if (month === 1 && dayOfMonth === 1) return false;
    if (month === 7 && dayOfMonth === 4) return false;
    if (month === 12 && dayOfMonth === 25) return false;
    if (month === 1 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 2 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 5 && dayOfMonth >= 25 && dayOfWeek === 1) return false;
    if (month === 9 && dayOfMonth <= 7 && dayOfWeek === 1) return false;
    if (month === 11 && dayOfMonth >= 22 && dayOfMonth <= 28 && dayOfWeek === 4) return false;
    return true;
  }

  if (market === 'JP') {
    if (month === 1 && dayOfMonth <= 3) return false;
    if (month === 2 && dayOfMonth === 11) return false;
    if (month === 2 && dayOfMonth === 23) return false;
    if (month === 3 && (dayOfMonth === 20 || dayOfMonth === 21)) return false;
    if (month === 4 && dayOfMonth === 29) return false;
    if (month === 5 && dayOfMonth === 3) return false;
    if (month === 5 && dayOfMonth === 5) return false;
    if (month === 8 && dayOfMonth === 11) return false;
    if (month === 11 && dayOfMonth === 3) return false;
    if (month === 11 && dayOfMonth === 23) return false;
    if (month === 1 && dayOfMonth >= 8 && dayOfMonth <= 14 && dayOfWeek === 1) return false;
    if (month === 7 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 9 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 10 && dayOfMonth >= 8 && dayOfMonth <= 14 && dayOfWeek === 1) return false;
    if (month === 9 && (dayOfMonth === 22 || dayOfMonth === 23)) return false;
    return true;
  }

  return true;
}

/**
 * 営業日のみフィルタリング
 * @param {Array<string>} dates - 日付配列
 * @param {string} market - 'US' or 'JP'
 * @returns {Array<string>} 営業日のみ
 */
function filterTradingDays(dates, market = 'JP') {
  return dates.filter(date => isTradingDay(date, market));
}

/**
 * CC / OC リターン系列（generate_signal / server と同一の寛容な挙動）
 */
function computeReturns(ohlc, type = 'cc') {
  if (!ohlc || ohlc.length === 0) return [];
  if (type === 'cc') {
    if (ohlc.length < 2) return [];
    try {
      return computeCCReturns(ohlc);
    } catch (e) {
      logger.warn('computeReturns(cc) skipped', { error: e.message });
      return [];
    }
  }
  try {
    return computeOCReturns(ohlc);
  } catch (e) {
    logger.warn('computeReturns(oc) skipped', { error: e.message });
    return [];
  }
}

/**
 * Yahoo / CSV から OHLCV を取得（リトライは Yahoo のみ）
 * @param {string} ticker
 * @param {number} days カレンダー日ベースの窓（CSV 時は末尾スライスに使用）
 * @param {object} appConfig lib/config の config オブジェクト
 * @returns {Promise<{ data: Array, error: string|null }>}
 */
async function fetchTickerOhlcv(ticker, days, appConfig) {
  if (appConfig.data.mode === 'csv') {
    const filePath = path.join(path.resolve(appConfig.data.dataDir), `${ticker}.csv`);
    if (!fs.existsSync(filePath)) {
      logger.error(`CSV not found: ${filePath}`);
      return { data: [], error: `CSV not found: ${filePath}` };
    }
    try {
      const rows = loadCSV(filePath).map(row => ({
        date: String(row.Date || row.date || '').split('T')[0],
        open: parseFloat(row.Open ?? row.open) || 0,
        high: parseFloat(row.High ?? row.high) || 0,
        low: parseFloat(row.Low ?? row.low) || 0,
        close: parseFloat(row.Close ?? row.close) || 0,
        volume: parseFloat(row.Volume ?? row.volume) || 0
      })).filter(r => r.date && Number.isFinite(r.close) && r.close > 0);
      const data = days > 0 && rows.length > days ? rows.slice(-days) : rows;
      return { data, error: null };
    } catch (error) {
      logger.error(`Failed to load ${ticker}`, { error: error.message });
      return { data: [], error: error.message };
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

    return { data, error: null };
  } catch (error) {
    logger.warn(`Failed to fetch ${ticker}`, { error: error.message });
    return { data: [], error: error.message };
  }
}

/**
 * 複数ティッカーを並列取得
 * @returns {Promise<{ byTicker: Object<string, Array>, errors: Object<string, string> }>}
 */
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

/**
 * OHLCV から日付→銘柄→リターンの Map を構築し、論文アライメント済み系列を返す
 */
function buildReturnMatricesFromOhlcv(usData, jpData, usTickers, jpTickers, jpWindowReturn = 'cc') {
  const usMap = new Map();
  const jpCCMap = new Map();
  const jpOCMap = new Map();

  for (const t of usTickers) {
    for (const r of computeReturns(usData[t] || [], 'cc')) {
      if (!usMap.has(r.date)) usMap.set(r.date, {});
      usMap.get(r.date)[t] = r.return;
    }
  }
  for (const t of jpTickers) {
    const d = jpData[t] || [];
    for (const r of computeReturns(d, 'cc')) {
      if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
      jpCCMap.get(r.date)[t] = r.return;
    }
    for (const r of computeReturns(d, 'oc')) {
      if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
      jpOCMap.get(r.date)[t] = r.return;
    }
  }

  return buildPaperAlignedReturnRows(
    usMap,
    jpCCMap,
    jpOCMap,
    usTickers,
    jpTickers,
    jpWindowReturn
  );
}

module.exports = {
  fetchWithRetry,
  alignDates,
  alignDatesLegacy,
  buildPaperAlignedReturnRows,
  parseCSV,
  loadCSV,
  saveCSV,
  computeCCReturns,
  computeOCReturns,
  computeReturns,
  fetchTickerOhlcv,
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv,
  buildReturnMatrix,
  transpose,
  fillForward,
  fillBackward,
  fillLinear,
  dropNA,
  isTradingDay,
  filterTradingDays
};
