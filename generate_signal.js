/**
 * シグナル生成スクリプト
 * Usage: node generate_signal.js [--window 60] [--lambda 0.9] [--quantile 0.4]
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ライブラリ
const { createLogger } = require('./lib/logger');
const { config } = require('./lib/config');
const { LeadLagSignal } = require('./lib/pca');
const { buildPortfolio, computePerformanceMetrics } = require('./lib/portfolio');
const { correlationMatrixSample } = require('./lib/math');
const { loadCSV, buildPaperAlignedReturnRows } = require('./lib/data');

const logger = createLogger('SignalGenerator');

// 米国セクター ETF
const US_ETF_TICKERS = [
  'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP',
  'XLRE', 'XLU', 'XLV', 'XLY'
];

// 日本セクター ETF
const JP_ETF_TICKERS = [
  '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
  '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
  '1631.T', '1632.T', '1633.T'
];

const JP_ETF_NAMES = {
  '1617.T': '食品', '1618.T': 'エネルギー資源', '1619.T': '建設・資材',
  '1620.T': '素材・化学', '1621.T': '医薬品', '1622.T': '自動車・輸送機',
  '1623.T': '鉄鋼・非鉄', '1624.T': '機械', '1625.T': '電機・精密',
  '1626.T': '情報通信', '1627.T': '電力・ガス', '1628.T': '運輸・物流',
  '1629.T': '商社・卸売', '1630.T': '小売', '1631.T': '銀行',
  '1632.T': '証券・商品', '1633.T': '保険'
};

/**
 * Yahoo Financeからデータを取得
 */
async function fetchData(ticker, days = 200) {
  if (config.data.mode === 'csv') {
    const filePath = path.join(path.resolve(config.data.dataDir), `${ticker}.csv`);
    if (!fs.existsSync(filePath)) {
      logger.error(`CSV not found: ${filePath}`);
      return [];
    }
    try {
      const rows = loadCSV(filePath).map(row => ({
        date: String(row.Date || row.date || '').split('T')[0],
        open: Number(row.Open ?? row.open),
        high: Number(row.High ?? row.high),
        low: Number(row.Low ?? row.low),
        close: Number(row.Close ?? row.close),
        volume: Number(row.Volume ?? row.volume ?? 0)
      })).filter(r => r.date && Number.isFinite(r.close) && r.close > 0);
      return days > 0 && rows.length > days ? rows.slice(-days) : rows;
    } catch (error) {
      logger.error(`Failed to load ${ticker}`, { error: error.message });
      return [];
    }
  }

  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yahooFinance = new YahooFinance();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await yahooFinance.chart(ticker, {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d'
    });

    return result.quotes
      .filter(q => q.close !== null && q.close > 0)
      .map(q => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume
      }));
  } catch (error) {
    logger.error(`Failed to fetch ${ticker}`, { error: error.message });
    return [];
  }
}

/**
 * リターンを計算
 */
function computeReturns(ohlc, type = 'cc') {
  if (!ohlc || ohlc.length < 2) return [];

  if (type === 'cc') {
    const returns = [];
    let prev = null;
    for (const r of ohlc) {
      if (prev !== null) {
        returns.push({ date: r.date, return: (r.close - prev) / prev });
      }
      prev = r.close;
    }
    return returns;
  } else {
    return ohlc
      .filter(r => r.open > 0)
      .map(r => ({ date: r.date, return: (r.close - r.open) / r.open }));
  }
}

/**
 * コマンドライン引数を解析
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    windowLength: config.backtest.windowLength,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    save: true
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--window':
      case '-w':
        options.windowLength = parseInt(args[++i]);
        break;
      case '--lambda':
      case '-l':
        options.lambdaReg = parseFloat(args[++i]);
        break;
      case '--quantile':
      case '-q':
        options.quantile = parseFloat(args[++i]);
        break;
      case '--no-save':
        options.save = false;
        break;
      case '--help':
      case '-h':
        console.log('Usage: node generate_signal.js [options]');
        console.log('Options:');
        console.log('  --window, -w <n>    Window length (default: 60)');
        console.log('  --lambda, -l <n>    Lambda regularization (default: 0.9)');
        console.log('  --quantile, -q <n>  Quantile (default: 0.4)');
        console.log('  --no-save           Do not save results');
        console.log('  --help, -h          Show this help');
        process.exit(0);
    }
  }

  return options;
}

/**
 * メイン処理
 */
async function main() {
  const options = parseArgs();

  logger.info('Signal generation started', options);

  // データ取得
  console.log('\n📡 Fetching data from Yahoo Finance...');

  const usData = {};
  for (const ticker of US_ETF_TICKERS) {
    process.stdout.write(`  ${ticker}... `);
    usData[ticker] = await fetchData(ticker, options.windowLength + 50);
    console.log(`${usData[ticker].length} days`);
  }

  const jpData = {};
  for (const ticker of JP_ETF_TICKERS) {
    process.stdout.write(`  ${ticker}... `);
    jpData[ticker] = await fetchData(ticker, options.windowLength + 50);
    console.log(`${jpData[ticker].length} days`);
  }

  const usCC = {};
  const jpCC = {};
  const jpOC = {};

  for (const t of US_ETF_TICKERS) {
    usCC[t] = computeReturns(usData[t], 'cc');
  }
  for (const t of JP_ETF_TICKERS) {
    jpCC[t] = computeReturns(jpData[t], 'cc');
    jpOC[t] = computeReturns(jpData[t], 'oc');
  }

  const usMap = new Map();
  for (const t of US_ETF_TICKERS) {
    for (const r of usCC[t]) {
      if (!usMap.has(r.date)) usMap.set(r.date, {});
      usMap.get(r.date)[t] = r.return;
    }
  }
  const jpCCMap = new Map();
  const jpOCMap = new Map();
  for (const t of JP_ETF_TICKERS) {
    for (const r of jpCC[t]) {
      if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
      jpCCMap.get(r.date)[t] = r.return;
    }
    for (const r of jpOC[t]) {
      if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
      jpOCMap.get(r.date)[t] = r.return;
    }
  }

  const { retUs, retJp } = buildPaperAlignedReturnRows(
    usMap,
    jpCCMap,
    jpOCMap,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  console.log(`\n📊 Data prepared: ${retUs.length} trading days`);

  if (retUs.length < options.windowLength) {
    logger.error('Insufficient data');
    console.error('Error: Insufficient data for window length');
    process.exit(1);
  }

  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  const signalGen = new LeadLagSignal({
    lambdaReg: options.lambdaReg,
    nFactors: config.backtest.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const retUsWin = retUs.slice(-options.windowLength).map(r => r.values);
  const retJpWin = retJp.slice(-options.windowLength).map(r => r.values);
  const retUsLatest = retUs[retUs.length - 1].values;

  const signal = signalGen.computeSignal(
    retUsWin,
    retJpWin,
    retUsLatest,
    config.sectorLabels,
    CFull
  );

  // ランキング作成
  const signals = JP_ETF_TICKERS.map((ticker, i) => ({
    ticker,
    name: JP_ETF_NAMES[ticker] || ticker,
    sector: config.sectorLabels[`JP_${ticker}`] || 'unknown',
    signal: signal[i],
    rank: 0
  })).sort((a, b) => b.signal - a.signal);

  signals.forEach((s, i) => s.rank = i + 1);

  // 買い/売り候補
  const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * options.quantile));
  const buyCandidates = signals.slice(0, buyCount);
  const sellCandidates = signals.slice(-buyCount);

  // 結果表示
  console.log('\n' + '='.repeat(60));
  console.log('📈 買い銘柄（ロング）');
  console.log('='.repeat(60));
  console.log('Rank  Ticker    業種           シグナル値');
  console.log('-'.repeat(60));

  buyCandidates.forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${s.ticker.padEnd(8)} ${s.name.padEnd(12)} ${(s.signal * 1000).toFixed(2)}`
    );
  });

  console.log('\n' + '='.repeat(60));
  console.log('📉 売り銘柄（ショート）');
  console.log('='.repeat(60));
  console.log('Rank  Ticker    業種           シグナル値');
  console.log('-'.repeat(60));

  sellCandidates.slice().reverse().forEach((s, i) => {
    console.log(
      `${String(buyCount - i).padStart(4)}  ${s.ticker.padEnd(8)} ${s.name.padEnd(12)} ${(s.signal * 1000).toFixed(2)}`
    );
  });

  // シグナル統計
  const meanSignal = signal.reduce((a, b) => a + b, 0) / signal.length;
  const stdSignal = Math.sqrt(signal.reduce((sq, x) => sq + Math.pow(x - meanSignal, 2), 0) / signal.length);

  console.log('\n' + '='.repeat(60));
  console.log('📊 シグナル統計');
  console.log('='.repeat(60));
  console.log(`  平均: ${(meanSignal * 1000).toFixed(4)}`);
  console.log(`  標準偏差: ${(stdSignal * 1000).toFixed(4)}`);
  console.log(`  最大: ${(Math.max(...signal) * 1000).toFixed(4)}`);
  console.log(`  最小: ${(Math.min(...signal) * 1000).toFixed(4)}`);

  // 結果保存
  if (options.save) {
    const outputDir = config.data.outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const result = {
      timestamp: new Date().toISOString(),
      config: options,
      signals,
      buyCandidates,
      sellCandidates,
      statistics: { meanSignal, stdSignal }
    };

    const jsonPath = path.join(outputDir, 'signal.json');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

    const csvPath = path.join(outputDir, 'signal_long.csv');
    const csvContent = 'Rank,Ticker,Name,Sector,Signal\n' +
      buyCandidates.map((s, i) =>
        `${i + 1},${s.ticker},${s.name},${s.sector},${s.signal}`
      ).join('\n');
    fs.writeFileSync(csvPath, csvContent);

    console.log(`\n💾 Results saved:`);
    console.log(`  - ${jsonPath}`);
    console.log(`  - ${csvPath}`);
  }

  logger.info('Signal generation completed');
}

main().catch(error => {
  logger.error('Signal generation failed', { error: error.message, stack: error.stack });
  console.error('Error:', error.message);
  process.exit(1);
});
