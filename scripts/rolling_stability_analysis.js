/**
 * 3-6ヶ月ローリング安定性分析
 * 現行パラメータで 1/3/6 ヶ月の窓評価を行う
 *
 * Usage: node scripts/rolling_stability_analysis.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { config } = require('../lib/config');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { computePerformanceMetrics } = require('../lib/portfolio');
const {
  BACKTEST_CONFIG,
  runBacktestWithMarketRegime
} = require('./backtest_with_market_regime');

const WINDOW_DEFS = [
  { label: '1m', days: 21 },
  { label: '3m', days: 63 },
  { label: '6m', days: 126 }
];

function evaluateWindow(strategyReturns, windowDays) {
  if (!Array.isArray(strategyReturns) || strategyReturns.length === 0) {
    return {
      days: 0,
      totalReturn: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      startDate: null,
      endDate: null
    };
  }

  const start = Math.max(0, strategyReturns.length - windowDays);
  const sliced = strategyReturns.slice(start);
  const returns = sliced.map(r => r.return);
  const metrics = computePerformanceMetrics(returns);

  return {
    days: sliced.length,
    totalReturn: metrics.Cumulative - 1,
    sharpeRatio: metrics.RR,
    maxDrawdown: metrics.MDD,
    winRate: sliced.filter(r => r.return > 0).length / sliced.length,
    startDate: sliced[0]?.date || null,
    endDate: sliced[sliced.length - 1]?.date || null
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('📊 1/3/6 ヶ月ローリング安定性分析（現行パラメータ）');
  console.log('='.repeat(80));

  const winDays = 500;
  console.log(`\n📡 市場データ取得中（${winDays}日分）...`);

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);

  const { retUs, retJp, retJpOc } = buildReturnMatricesFromOhlcv(
    usRes.byTicker,
    jpRes.byTicker,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  console.log(`📊 取得完了：${retUs.length}営業日分`);

  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  const standardParams = {
    ...BACKTEST_CONFIG,
    marketRegime: {
      enabled: false,
      lookback: BACKTEST_CONFIG.marketRegime.lookback,
      positionSizeBull: 1.0,
      positionSizeBear: 1.0,
      positionSizeNeutral: 1.0
    }
  };

  const standard = runBacktestWithMarketRegime(
    retUs,
    retJpOc,
    standardParams,
    config.sectorLabels,
    CFull
  );

  const improved = runBacktestWithMarketRegime(
    retUs,
    retJpOc,
    BACKTEST_CONFIG,
    config.sectorLabels,
    CFull
  );

  const rolling = WINDOW_DEFS.map(w => {
    const std = evaluateWindow(standard.returns, w.days);
    const imp = evaluateWindow(improved.returns, w.days);
    return {
      window: w.label,
      tradingDays: w.days,
      standard: std,
      improved: imp,
      diff: {
        totalReturn: imp.totalReturn - std.totalReturn,
        sharpeRatio: imp.sharpeRatio - std.sharpeRatio,
        maxDrawdown: imp.maxDrawdown - std.maxDrawdown,
        winRate: imp.winRate - std.winRate
      }
    };
  });

  console.log('\n' + '='.repeat(80));
  console.log('📈 ローリング結果（Improved - Standard）');
  console.log('='.repeat(80));
  console.log('Window  ReturnDiff(%)  SharpeDiff  WinRateDiff(%)  MaxDDDiff(%)');
  console.log('-'.repeat(80));
  rolling.forEach(r => {
    console.log(
      `${r.window.padEnd(6)}  ` +
      `${(r.diff.totalReturn * 100).toFixed(2).padStart(12)}  ` +
      `${r.diff.sharpeRatio.toFixed(2).padStart(10)}  ` +
      `${(r.diff.winRate * 100).toFixed(2).padStart(14)}  ` +
      `${(r.diff.maxDrawdown * 100).toFixed(2).padStart(11)}`
    );
  });

  const output = {
    analysisDate: new Date().toISOString(),
    config: {
      backtest: {
        lambdaReg: BACKTEST_CONFIG.lambdaReg,
        nFactors: BACKTEST_CONFIG.nFactors,
        quantile: BACKTEST_CONFIG.quantile,
        shortRatio: BACKTEST_CONFIG.shortRatio,
        dailyLossStop: BACKTEST_CONFIG.dailyLossStop
      },
      marketRegime: BACKTEST_CONFIG.marketRegime
    },
    dataLength: retUs.length,
    rolling
  };

  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outPath = path.join(outputDir, `rolling_stability_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 結果を保存しました：${outPath}`);
}

main().catch(error => {
  console.error('❌ エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
