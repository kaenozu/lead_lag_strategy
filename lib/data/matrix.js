'use strict';

const { transpose } = require('../math');
const { fillForward } = require('./imputation');
const { computeReturns } = require('./returns');
const { buildPaperAlignedReturnRows } = require('./alignment');

function buildReturnMatrix(returnsMap) {
  const tickers = Object.keys(returnsMap);
  if (tickers.length === 0) {
    throw new Error('No return data provided');
  }

  const dateSet = new Set();
  for (const ticker of tickers) {
    for (const r of returnsMap[ticker]) {
      dateSet.add(r.date);
    }
  }
  const dates = Array.from(dateSet).sort();

  const dateIndex = new Map();
  dates.forEach((date, i) => dateIndex.set(date, i));

  const matrix = [];
  for (const ticker of tickers) {
    const row = new Array(dates.length).fill(null);
    for (const r of returnsMap[ticker]) {
      const idx = dateIndex.get(r.date);
      if (idx !== undefined) {
        row[idx] = r.return;
      }
    }
    const filledRow = fillForward(row);
    matrix.push(filledRow);
  }

  return {
    dates,
    matrix: transpose(matrix),
    tickers
  };
}

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
  buildReturnMatrix,
  buildReturnMatricesFromOhlcv,
  transpose
};
