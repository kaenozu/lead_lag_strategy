/**
 * Phase 2 Alternative Improvements Test
 *
 * Tests 5 configurations against the Phase 1 baseline:
 *   1. Baseline:        quantile=0.4, daily, no threshold
 *   2. Low quantile:    quantile=0.3, daily, no threshold
 *   3. Very low quant:  quantile=0.25, daily, no threshold
 *   4. Weekly rebalance: quantile=0.4, every 5 days, no threshold
 *   5. Signal threshold: quantile=0.4, daily, spread > 0.05
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Same imports as backtest/real.js
const { config } = require('../lib/config');
const {
  fetchOhlcvDateRangeForTickers,
  loadCSV
} = require('../lib/data');
const {
  buildReturnMatricesFromOhlcv
} = require('../backtest/common');
const { LeadLagSignal } = require('../lib/pca/signal');
const { buildPortfolio } = require('../lib/portfolio/build');
const { computePerformanceMetrics, applyTransactionCosts } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { SECTOR_LABELS, US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { normalizeStd } = require('../lib/pca/signal_utils');

// ============================================================================
// Data loading (same as real.js)
// ============================================================================

function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const data = loadCSV(filePath);
      results[ticker] = data.map(row => ({
        date: row.Date || row.date,
        open: row.Open || row.open,
        high: row.High || row.high,
        low: row.Low || row.low,
        close: row.Close || row.close,
        volume: row.Volume || row.volume || 0
      }));
    } else {
      console.error(`  WARNING: File not found: ${ticker}`);
      results[ticker] = [];
    }
  }
  return results;
}

// ============================================================================
// Configurations
// ============================================================================

const CONFIGURATIONS = [
  {
    name: 'Baseline (q=0.4, daily)',
    quantile: 0.4,
    rebalanceInterval: 1,
    signalThreshold: 0
  },
  {
    name: 'Low quantile (q=0.3)',
    quantile: 0.3,
    rebalanceInterval: 1,
    signalThreshold: 0
  },
  {
    name: 'Very low quantile (q=0.25)',
    quantile: 0.25,
    rebalanceInterval: 1,
    signalThreshold: 0
  },
  {
    name: 'Weekly rebalance (5d)',
    quantile: 0.4,
    rebalanceInterval: 5,
    signalThreshold: 0
  },
  {
    name: 'Signal threshold (spread>0.05)',
    quantile: 0.4,
    rebalanceInterval: 1,
    signalThreshold: 0.05
  },
  {
    name: 'Signal threshold (spread>0.10)',
    quantile: 0.4,
    rebalanceInterval: 1,
    signalThreshold: 0.10
  },
  {
    name: 'Signal threshold (spread>0.20)',
    quantile: 0.4,
    rebalanceInterval: 1,
    signalThreshold: 0.20
  }
];

// ============================================================================
// Backtest engine (modified for per-configuration hooks)
// ============================================================================

/**
 * Run a single configuration's backtest.
 *
 * @param {Object} returnsUs   - US CC return series [{ date, values }]
 * @param {Object} returnsJp   - JP CC return series
 * @param {Object} returnsJpOc - JP OC return series
 * @param {Object} baseConfig  - PCA/window config (same for all runs)
 * @param {Object} testConfig  - quantile, rebalanceInterval, signalThreshold
 * @returns {{ returns: Array, dates: Array, tradingDays: number }}
 */
function runConfigBacktest(returnsUs, returnsJp, returnsJpOc, baseConfig, testConfig) {
  const nJp = returnsJp[0].values.length;
  const strategyReturns = [];
  const dates = [];
  let activeDays = 0;  // days with non-zero position

  const signalGenerator = new LeadLagSignal(baseConfig);
  let prevWeights = null;
  let cachedWeights = null;
  let daysSinceRebalance = 0;

  for (let i = baseConfig.warmupPeriod; i < returnsJpOc.length; i++) {
    const windowStart = i - baseConfig.windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);

    // Correlation from rolling window (same as real.js)
    const CFull = correlationMatrixSample(
      retUsWindow.map((r, k) => [...r, ...retJpWindow[k]])
    );

    // US latest return (t-1 to avoid lookahead bias)
    const retUsLatest = returnsUs[i - 1].values;

    // Determine if we should recompute weights this day
    const shouldRebalance = (testConfig.rebalanceInterval <= 1) ||
      (daysSinceRebalance === 0) ||
      (daysSinceRebalance >= testConfig.rebalanceInterval);

    if (shouldRebalance) {
      // Compute PCA signal
      const signal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, SECTOR_LABELS, CFull, null
      );

      // Signal threshold check on RAW signal (before normalization)
      // normalizeStd would make spread always large, so we check the raw spread
      const rawSpread = Math.max(...signal) - Math.min(...signal);

      let weights;
      if (testConfig.signalThreshold > 0 && rawSpread < testConfig.signalThreshold) {
        // Signal too compressed - no position
        weights = new Array(nJp).fill(0);
      } else {
        const normalizedSignal = normalizeStd(signal);
        weights = buildPortfolio(normalizedSignal, testConfig.quantile);
      }

      cachedWeights = weights;
      daysSinceRebalance = 0;
    }

    const weights = cachedWeights;
    daysSinceRebalance++;

    // Track active days (days with non-zero positions)
    const hasPosition = weights.some(w => Math.abs(w) > 1e-10);
    if (hasPosition) activeDays++;

    // PnL using OC returns (same as real.js to avoid lookahead bias)
    const retNext = returnsJpOc[i].values;
    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }

    // Apply transaction costs
    strategyRet = applyTransactionCosts(
      strategyRet, baseConfig.transactionCosts, prevWeights, weights
    );

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: strategyRet
    });
    dates.push(returnsJpOc[i].date);
  }

  return { returns: strategyReturns, dates, tradingDays: strategyReturns.length, activeDays };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('Phase 2 Alternative Improvements Test');
  console.log('='.repeat(80));
  console.log();

  // Load data (same as real.js)
  const dataDir = path.resolve(__dirname, '..', 'backtest', 'data');
  console.log(`Loading data from: ${dataDir}`);

  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  const usCount = Object.values(usData).filter(d => d.length > 0).length;
  const jpCount = Object.values(jpData).filter(d => d.length > 0).length;
  console.log(`  US tickers loaded: ${usCount}/${US_ETF_TICKERS.length}`);
  console.log(`  JP tickers loaded: ${jpCount}/${JP_ETF_TICKERS.length}`);

  if (usCount === 0 || jpCount === 0) {
    console.error('ERROR: No data available. Run backtest/real.js first to download data.');
    process.exit(1);
  }

  // Build return matrices (same as real.js)
  console.log('Building return matrices...');
  const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc, dates } =
    buildReturnMatricesFromOhlcv(usData, jpData, config.backtest.jpWindowReturn);

  console.log(`  Total trading days: ${dates.length}`);
  console.log(`  Period: ${dates[0]} ~ ${dates[dates.length - 1]}`);

  if (dates.length < 100) {
    console.error('ERROR: Insufficient data (< 100 trading days)');
    process.exit(1);
  }

  // Base config (Phase 1 parameters, same for all runs)
  const baseConfig = {
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,        // overridden per-test
    warmupPeriod: config.backtest.windowLength,
    transactionCosts: config.backtest.transactionCosts,
    orderedSectorKeys: config.pca.orderedSectorKeys,
    useAdaptiveLambda: false,                  // Phase 1: adaptive lambda disabled
    lambdaMin: config.backtest.adaptiveLambdaMin,
    lambdaMax: config.backtest.adaptiveLambdaMax,
    volLow: config.backtest.volLow,
    volHigh: config.backtest.volHigh,
    signalStability: {
      smoothingAlpha: 0,        // Phase 1: no smoothing
      maxTurnoverPerDay: 1      // Phase 1: no turnover limit
    },
    riskLimits: {
      maxAbsWeight: 1,          // Phase 1: no position cap
      dailyLossStop: 0          // Phase 1: no daily loss stop
    }
  };

  console.log();
  console.log('Base Config (Phase 1):');
  console.log(`  windowLength:    ${baseConfig.windowLength}`);
  console.log(`  nFactors:        ${baseConfig.nFactors}`);
  console.log(`  lambdaReg:       ${baseConfig.lambdaReg}`);
  console.log(`  transactionCosts: slippage=${baseConfig.transactionCosts.slippage}, commission=${baseConfig.transactionCosts.commission}`);
  console.log();

  // Run each configuration
  const results = [];

  for (const testConfig of CONFIGURATIONS) {
    console.log(`Running: ${testConfig.name}...`);
    const startMs = Date.now();

    const btResult = runConfigBacktest(
      returnsUs, returnsJp, returnsJpOc, baseConfig, testConfig
    );

    const metrics = computePerformanceMetrics(btResult.returns.map(r => r.return));
    const elapsedMs = Date.now() - startMs;

    results.push({
      name: testConfig.name,
      config: testConfig,
      metrics,
      tradingDays: btResult.tradingDays,
      activeDays: btResult.activeDays,
      elapsedMs
    });

    console.log(`  Done in ${elapsedMs}ms (${btResult.tradingDays} days, ${btResult.activeDays} active)`);
  }

  // ============================================================================
  // Print comparison table
  // ============================================================================

  console.log();
  console.log('='.repeat(110));
  console.log('COMPARISON TABLE');
  console.log('='.repeat(110));
  console.log();

  // Header
  const col1 = 'Config'.padEnd(32);
  const col2 = 'AR (%)'.padStart(9);
  const col3 = 'RISK (%)'.padStart(9);
  const col4 = 'R/R'.padStart(7);
  const col5 = 'MDD (%)'.padStart(9);
  const col6 = 'Total (%)'.padStart(10);
  const col7 = 'Active'.padStart(7);
  const col8 = 'Time'.padStart(6);

  console.log(`${col1} ${col2} ${col3} ${col4} ${col5} ${col6} ${col7} ${col8}`);
  console.log('-'.repeat(110));

  for (const r of results) {
    const m = r.metrics;
    const activeLabel = `${r.activeDays}/${r.tradingDays}`;
    const line =
      r.name.padEnd(32) +
      (m.AR * 100).toFixed(2).padStart(9) +
      (m.RISK * 100).toFixed(2).padStart(9) +
      m.RR.toFixed(2).padStart(7) +
      (m.MDD * 100).toFixed(2).padStart(9) +
      ((m.Cumulative - 1) * 100).toFixed(2).padStart(10) +
      activeLabel.padStart(7) +
      `${r.elapsedMs}ms`.padStart(6);
    console.log(line);
  }

  console.log('-'.repeat(110));

  // Delta from baseline
  const baseline = results[0].metrics;
  console.log();
  console.log('DELTA FROM BASELINE');
  console.log('-'.repeat(110));

  for (const r of results) {
    const m = r.metrics;
    const dAR = ((m.AR - baseline.AR) * 100).toFixed(2);
    const dRISK = ((m.RISK - baseline.RISK) * 100).toFixed(2);
    const dRR = (m.RR - baseline.RR).toFixed(2);
    const dMDD = ((m.MDD - baseline.MDD) * 100).toFixed(2);
    const dTotal = (((m.Cumulative - 1) - (baseline.Cumulative - 1)) * 100).toFixed(2);

    console.log(
      r.name.padEnd(32) +
      (dAR >= 0 ? '+' : '') + dAR.padStart(9) +
      (dRISK >= 0 ? '+' : '') + dRISK.padStart(9) +
      (dRR >= 0 ? '+' : '') + dRR.padStart(7) +
      (dMDD >= 0 ? '+' : '') + dMDD.padStart(9) +
      (dTotal >= 0 ? '+' : '') + dTotal.padStart(10)
    );
  }

  console.log('-'.repeat(110));

  // Summary interpretation
  console.log();
  console.log('='.repeat(110));
  console.log('INTERPRETATION');
  console.log('='.repeat(110));

  // Find best config by R/R
  const bestRR = results.slice(1).reduce((best, r) =>
    r.metrics.RR > best.metrics.RR ? r : best, results[1]);
  console.log(`Best R/R (excl. baseline): ${bestRR.name} (R/R=${bestRR.metrics.RR.toFixed(2)})`);

  // Find best config by MDD (least negative)
  const bestMDD = results.slice(1).reduce((best, r) =>
    r.metrics.MDD > best.metrics.MDD ? r : best, results[1]);
  console.log(`Best MDD (excl. baseline): ${bestMDD.name} (MDD=${(bestMDD.metrics.MDD * 100).toFixed(2)}%)`);

  // Find best config by AR
  const bestAR = results.slice(1).reduce((best, r) =>
    r.metrics.AR > best.metrics.AR ? r : best, results[1]);
  console.log(`Best AR  (excl. baseline): ${bestAR.name} (AR=${(bestAR.metrics.AR * 100).toFixed(2)}%)`);

  // Signal threshold specifics
  const thresholdResults = results.filter(r => r.config.signalThreshold > 0);
  if (thresholdResults.length > 0) {
    console.log();
    console.log('Signal threshold analysis:');
    for (const tr of thresholdResults) {
      const flatDays = tr.tradingDays - tr.activeDays;
      const filteredPct = ((flatDays / tr.tradingDays) * 100).toFixed(1);
      console.log(
        `  spread>${tr.config.signalThreshold}: ${tr.activeDays} active / ${tr.tradingDays} total, ` +
        `${filteredPct}% flat days, AR=${(tr.metrics.AR * 100).toFixed(2)}%, ` +
        `R/R=${tr.metrics.RR.toFixed(2)}, MDD=${(tr.metrics.MDD * 100).toFixed(2)}%`
      );
    }
  }

  console.log();
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { runConfigBacktest, CONFIGURATIONS };
