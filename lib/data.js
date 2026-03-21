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
 * CSVデータをパース
 * @param {string} csvText - CSVテキスト
 * @returns {Array<Object>} パースされたデータ
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
        // 数値に変換を試みる
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
 * CSVファイルを読み込み
 * @param {string} filePath - ファイルパス
 * @returns {Array<Object>} パースされたデータ
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
 * データをCSVとして保存
 * @param {string} filePath - ファイルパス
 * @param {Array<Object>} data - 保存するデータ
 * @param {Array<string>} headers - ヘッダー（省略時は最初のオブジェクトのキーを使用）
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
 * OHLCVデータからClose-to-Closeリターンを計算
 * @param {Array<Object>} ohlcv - OHLCVデータ [{ date, open, high, low, close, volume }]
 * @returns {Array<Object>} リターン [{ date, return }]
 */
function computeCCReturns(ohlcv) {
  if (!ohlcv || ohlcv.length < 2) {
    throw new Error('Need at least 2 data points to compute returns');
  }

  const returns = [];
  let prevClose = null;

  for (const row of ohlcv) {
    const close = parseFloat(row.close);
    if (isNaN(close)) {
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
 * OHLCVデータからOpen-to-Closeリターンを計算
 * @param {Array<Object>} ohlcv - OHLCVデータ
 * @returns {Array<Object>} リターン [{ date, return }]
 */
function computeOCReturns(ohlcv) {
  if (!ohlcv || ohlcv.length === 0) {
    throw new Error('No data to compute returns');
  }

  const returns = [];

  for (const row of ohlcv) {
    const open = parseFloat(row.open);
    const close = parseFloat(row.close);

    if (isNaN(open) || isNaN(close)) {
      logger.warn(`Invalid price data for date ${row.date}`);
      continue;
    }

    if (open > 0) {
      returns.push({
        date: row.date,
        return: (close - open) / open
      });
    }
  }

  return returns;
}

/**
 * 複数銘柄のリターンを行列として構築
 * @param {Object} returnsMap - 銘柄ごとのリターン { ticker: [{ date, return }] }
 * @returns {Object} { dates: Array<string>, matrix: Array<Array<number>>, tickers: Array<string> }
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

  // 行列を構築
  const matrix = [];
  for (const ticker of tickers) {
    const row = new Array(dates.length).fill(null);
    for (const r of returnsMap[ticker]) {
      const idx = dateIndex.get(r.date);
      if (idx !== undefined) {
        row[idx] = r.return;
      }
    }
    matrix.push(row);
  }

  return {
    dates,
    matrix: transpose(matrix),
    tickers
  };
}

/**
 * 行列の転置
 * @param {Array<Array<number>>} matrix - 入力行列
 * @returns {Array<Array<number>>} 転置行列
 */
function transpose(matrix) {
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

/**
 * 欠損値を補間（前方充填）
 * @param {Array<number>} arr - 入力配列
 * @returns {Array<number>} 補間後の配列
 */
function fillForward(arr) {
  const result = [...arr];
  let lastValid = null;

  for (let i = 0; i < result.length; i++) {
    if (result[i] !== null && result[i] !== undefined && !isNaN(result[i])) {
      lastValid = result[i];
    } else if (lastValid !== null) {
      result[i] = lastValid;
    }
  }

  return result;
}

/**
 * 欠損値を削除したデータを返す
 * @param {Array<Object>} data - データ配列
 * @param {string} key - チェックするキー
 * @returns {Array<Object>} 欠損値を除外したデータ
 */
function dropNA(data, key) {
  return data.filter(row => {
    const val = row[key];
    return val !== null && val !== undefined && !isNaN(val);
  });
}

module.exports = {
  parseCSV,
  loadCSV,
  saveCSV,
  computeCCReturns,
  computeOCReturns,
  buildReturnMatrix,
  fillForward,
  dropNA
};
