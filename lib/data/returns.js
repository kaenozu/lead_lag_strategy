'use strict';

const { createLogger } = require('../logger');

const logger = createLogger('DataUtils');

function computeCCReturns(ohlcv) {
  if (!ohlcv || ohlcv.length < 2) {
    throw new Error('Need at least 2 data points to compute returns');
  }

  const returns = [];
  let prevClose = null;

  for (const row of ohlcv) {
    const close = parseFloat(row.Close ?? row.close);
    const date = row.Date ?? row.date;
    if (isNaN(close) || close <= 0) {
      continue;
    }

    if (prevClose !== null && prevClose > 0) {
      returns.push({
        date: date,
        return: (close - prevClose) / prevClose
      });
    }
    prevClose = close;
  }

  return returns;
}

function computeOCReturns(ohlcv) {
  if (!ohlcv || ohlcv.length === 0) {
    throw new Error('No data to compute returns');
  }

  const returns = [];

  for (let i = 1; i < ohlcv.length; i++) {
    const currRow = ohlcv[i];
    const open = parseFloat(currRow.Open ?? currRow.open);
    const close = parseFloat(currRow.Close ?? currRow.close);
    const date = currRow.Date ?? currRow.date;

    if (isNaN(open) || isNaN(close) || open <= 0) {
      continue;
    }

    returns.push({
      date: date,
      return: (close - open) / open
    });
  }

  return returns;
}

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

module.exports = {
  computeReturns,
  computeCCReturns,
  computeOCReturns
};
