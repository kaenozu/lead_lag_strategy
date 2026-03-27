'use strict';

/**
 * 今週の推奨銘柄パフォーマンス計算スクリプト
 * Weekly profit calculator for buy candidates from signal.json
 *
 * Usage: node scripts/weekly_profit.js
 */

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { fetchOhlcvDateRangeForTickers } = require('../lib/data');

// --- Configuration ---
const SIGNAL_PATH = path.join(__dirname, '..', 'results', 'signal.json');
const MONTH_START = '2026-02-27'; // 1 month ago
const MONTH_END = '2026-03-27';   // Today
const FETCH_START = '2026-02-25'; // A few days before for safety
const FETCH_END = '2026-03-27';

async function main() {
  // 1. Read signal.json
  if (!fs.existsSync(SIGNAL_PATH)) {
    console.error(`ERROR: signal.json not found at ${SIGNAL_PATH}`);
    process.exit(1);
  }

  const signalData = JSON.parse(fs.readFileSync(SIGNAL_PATH, 'utf8'));
  const buyCandidates = signalData.buyCandidates;

  if (!buyCandidates || buyCandidates.length === 0) {
    console.error('ERROR: No buyCandidates found in signal.json');
    process.exit(1);
  }

  console.log(`\nデータ取得中... (tickers: ${buyCandidates.map(c => c.ticker).join(', ')})`);

  // 2. Fetch price data
  const tickers = buyCandidates.map(c => c.ticker);
  let byTicker, errors;

  try {
    const result = await fetchOhlcvDateRangeForTickers(tickers, FETCH_START, FETCH_END, config);
    byTicker = result.byTicker;
    errors = result.errors;
  } catch (err) {
    console.error(`ERROR: Failed to fetch price data: ${err.message}`);
    process.exit(1);
  }

  // 3. Calculate profit for each candidate
  const results = [];

  for (const candidate of buyCandidates) {
    const { ticker, name } = candidate;
    const ohlcv = byTicker[ticker] || [];

    if (ohlcv.length === 0) {
      const errMsg = errors[ticker] || 'No data returned';
      results.push({
        name,
        ticker,
        buyPrice: null,
        currentPrice: null,
        profitPct: null,
        error: errMsg
      });
      continue;
    }

    // Sort by date ascending
    ohlcv.sort((a, b) => a.date.localeCompare(b.date));

    // Find buy price: open price on MONTH_START or first trading day after
    let buyPrice = null;
    let buyDate = null;
    for (const row of ohlcv) {
      if (row.date >= MONTH_START) {
        buyPrice = row.open;
        buyDate = row.date;
        break;
      }
    }

    // If no data on or after MONTH_START, use the first available day
    if (buyPrice === null && ohlcv.length > 0) {
      buyPrice = ohlcv[ohlcv.length - 1].open;
      buyDate = ohlcv[ohlcv.length - 1].date;
    }

    // Current price: latest close
    const latestRow = ohlcv[ohlcv.length - 1];
    const currentPrice = latestRow.close;
    const latestDate = latestRow.date;

    let profitPct = null;
    if (buyPrice !== null && buyPrice > 0) {
      profitPct = ((currentPrice - buyPrice) / buyPrice) * 100;
    }

    results.push({
      name,
      ticker,
      buyPrice,
      buyDate,
      currentPrice,
      latestDate,
      profitPct
    });
  }

  // 4. Print table
  const header = `過去1ヶ月の推奨銘柄パフォーマンス (${MONTH_START} ~ ${MONTH_END})`;
  const separator = '='.repeat(80);

  console.log('');
  console.log(header);
  console.log(separator);

  // Column widths
  const nameW = 14;
  const tickerW = 10;
  const buyW = 14;
  const curW = 14;
  const pctW = 10;

  const colNames = {
    name: '銘柄',
    ticker: 'ティッカー',
    buy: '買値(月初始値)',
    current: '現在値(最新終値)',
    pct: '利益率'
  };

  const headerLine =
    pad(colNames.name, nameW) +
    pad(colNames.ticker, tickerW) +
    pad(colNames.buy, buyW) +
    pad(colNames.current, curW) +
    colNames.pct;

  console.log(headerLine);
  console.log('-'.repeat(headerLine.length));

  let validCount = 0;
  let totalProfitPct = 0;

  for (const r of results) {
    if (r.error) {
      console.log(
        pad(r.name, nameW) +
        pad(r.ticker, tickerW) +
        pad('ERROR', buyW) +
        pad('', curW) +
        r.error.substring(0, 30)
      );
      continue;
    }

    const pctStr = formatPercent(r.profitPct);
    const buyStr = r.buyPrice !== null ? r.buyPrice.toFixed(2) : 'N/A';
    const curStr = r.currentPrice !== null ? r.currentPrice.toFixed(2) : 'N/A';

    console.log(
      pad(r.name, nameW) +
      pad(r.ticker, tickerW) +
      pad(buyStr, buyW) +
      pad(curStr, curW) +
      pctStr
    );

    if (r.profitPct !== null) {
      validCount++;
      totalProfitPct += r.profitPct;
    }
  }

  console.log(separator);

  // 5. Equal-weight portfolio profit
  if (validCount > 0) {
    const avgProfit = totalProfitPct / validCount;
    const sign = avgProfit >= 0 ? '+' : '';
    console.log(`等加重ポートフォリオ利益率: ${sign}${avgProfit.toFixed(2)}%  (${validCount}銘柄の平均)`);
  } else {
    console.log('等加重ポートフォリオ利益率: 計算不可 (有効データなし)');
  }

  console.log('');
}

function pad(str, width) {
  // Handle CJK characters (roughly double-width)
  let visualLen = 0;
  for (const ch of String(str)) {
    visualLen += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  const padding = Math.max(0, width - visualLen);
  return str + ' '.repeat(padding);
}

function formatPercent(pct) {
  if (pct === null || pct === undefined) return 'N/A';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
