/**
 * シグナル生成スクリプト
 * Usage: node generate_signal.js [--window 60] [--lambda 0.9] [--quantile 0.4]
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ライブラリ
const { createLogger } = require('../lib/logger');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');

const logger = createLogger('SignalGenerator');

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

  const winDays = options.windowLength + 50;
  console.log('\n📡 Loading market data (parallel per region)...');

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);

  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;
  for (const [t, err] of Object.entries({ ...usRes.errors, ...jpRes.errors })) {
    logger.error(`Data load failed: ${t}`, { error: err });
  }

  for (const ticker of US_ETF_TICKERS) {
    console.log(`  ${ticker}... ${usData[ticker].length} days`);
  }
  for (const ticker of JP_ETF_TICKERS) {
    console.log(`  ${ticker}... ${jpData[ticker].length} days`);
  }

  const { retUs, retJp } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
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

    console.log('\n💾 Results saved:');
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
