/**
 * Debug script to identify which Phase 2 improvement caused PCA_SUB performance degradation.
 * Tests 4 configurations:
 *   1. Baseline (Phase 1): no adaptive lambda, equal-weight (buildPortfolio), no normalization
 *   2. Only adaptive lambda: useAdaptiveLambda=true, equal-weight, no normalization
 *   3. Only weighted portfolio: no adaptive lambda, buildWeightedPortfolio, no normalization
 *   4. Only normalization: no adaptive lambda, equal-weight, normalizeStd
 *
 * Usage: node scripts/debug_improvements.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Imports ---
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const {
  buildPortfolio,
  buildWeightedPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts
} = require('../lib/portfolio');
const { buildReturnMatricesFromOhlcv } = require('../backtest/common');
const { correlationMatrixSample } = require('../lib/math');
const { normalizeStd } = require('../lib/pca/signal_utils');
const {
  capPositionWeights,
  smoothWeights,
  turnover
} = require('../backtest/common');
const { SECTOR_LABELS } = require('../lib/constants');

// Suppress verbose logging
process.env.LOG_LEVEL = 'warn';

// ============================================================================
// Data Loading (same as real.js loadLocalData)
// ============================================================================
function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.trim().split('\n');
      const header = lines[0].split(',');
      results[ticker] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const row = {};
        for (let j = 0; j < header.length; j++) {
          row[header[j]] = cols[j];
        }
        results[ticker].push({
          date: row.Date || row.date,
          open: parseFloat(row.Open || row.open),
          high: parseFloat(row.High || row.high),
          low: parseFloat(row.Low || row.low),
          close: parseFloat(row.Close || row.close),
          volume: parseFloat(row.Volume || row.volume || 0)
        });
      }
    } else {
      console.error(`Missing data file: ${filePath}`);
      results[ticker] = [];
    }
  }
  return results;
}

// ============================================================================
// Backtest runner (parameterized by flags)
// ============================================================================
function runConfigBacktest(returnsUs, returnsJp, returnsJpOc, btConfig, sectorLabels, flags) {
  const {
    useAdaptiveLambda,
    useWeightedPortfolio,
    useNormalization
  } = flags;

  const nJp = returnsJp[0].values.length;
  const signalGenerator = new LeadLagSignal(btConfig);
  const strategyReturns = [];
  let prevWeights = null;

  for (let i = btConfig.warmupPeriod; i < returnsJpOc.length; i++) {
    const windowStart = i - btConfig.windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);

    // Adaptive lambda: compute realized vol if enabled
    let realizedVol = null;
    if (useAdaptiveLambda) {
      const allUsReturns = retUsWindow.flat();
      const mean = allUsReturns.reduce((a, b) => a + b, 0) / allUsReturns.length;
      const variance = allUsReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / allUsReturns.length;
      realizedVol = Math.sqrt(variance * 252);
    }

    // Correlation matrix from rolling window (no lookahead)
    const CFull = correlationMatrixSample(
      retUsWindow.map((r, k) => [...r, ...retJpWindow[k]])
    );

    // Latest US returns (t-1 to avoid lookahead)
    const retUsLatest = returnsUs[i - 1].values;

    // Compute PCA signal
    const signal = signalGenerator.computeSignal(
      retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull, realizedVol
    );

    // Optionally normalize
    const finalSignal = useNormalization ? normalizeStd(signal) : signal;

    // Build portfolio weights
    let weights;
    if (useWeightedPortfolio) {
      weights = buildWeightedPortfolio(finalSignal, btConfig.quantile);
    } else {
      weights = buildPortfolio(finalSignal, btConfig.quantile);
    }

    // Signal smoothing + position cap (same as real.js defaults)
    const smoothingAlpha = Number(btConfig?.signalStability?.smoothingAlpha || 0);
    weights = smoothWeights(prevWeights, weights, smoothingAlpha);
    weights = capPositionWeights(weights, Number(btConfig?.riskLimits?.maxAbsWeight || 1));

    // Turnover limit
    const maxTurnoverPerDay = Number(btConfig?.signalStability?.maxTurnoverPerDay || 1);
    const todayTurnover = turnover(prevWeights, weights);
    if (prevWeights && Number.isFinite(maxTurnoverPerDay) && maxTurnoverPerDay > 0 && todayTurnover > maxTurnoverPerDay) {
      continue;
    }

    // Use OC returns (no lookahead)
    const retNext = returnsJpOc[i].values;

    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }

    // Transaction costs
    strategyRet = applyTransactionCosts(strategyRet, btConfig.transactionCosts, prevWeights, weights);

    // Daily loss stop
    const dailyLossStop = Number(btConfig?.riskLimits?.dailyLossStop || 0);
    if (Number.isFinite(dailyLossStop) && dailyLossStop > 0) {
      strategyRet = Math.max(strategyRet, -dailyLossStop);
    }

    prevWeights = weights;
    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: strategyRet
    });
  }

  return strategyReturns;
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('=== Phase 2 Improvement Debugging ===\n');

  // Load data (from backtest/data)
  const dataDir = path.resolve(__dirname, '..', 'backtest', 'data');
  const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');

  console.log('Loading data from:', dataDir);
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  // Build return matrices
  const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc, dates } =
    buildReturnMatricesFromOhlcv(usData, jpData, config.backtest.jpWindowReturn);

  console.log(`Trading days: ${dates.length}, Period: ${dates[0]} ~ ${dates[dates.length - 1]}\n`);

  if (dates.length < 100) {
    console.error('Insufficient data. Aborting.');
    process.exit(1);
  }

  // Base backtest config (matches real.js defaults)
  const baseConfig = {
    windowLength: config.backtest.windowLength,
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    quantile: config.backtest.quantile,
    warmupPeriod: config.backtest.windowLength,
    transactionCosts: config.backtest.transactionCosts,
    orderedSectorKeys: config.pca.orderedSectorKeys,
    // Adaptive lambda params (only used when useAdaptiveLambda flag is true)
    useAdaptiveLambda: false,
    lambdaMin: config.backtest.adaptiveLambdaMin,
    lambdaMax: config.backtest.adaptiveLambdaMax,
    volLow: config.backtest.volLow,
    volHigh: config.backtest.volHigh,
    signalStability: {
      smoothingAlpha: 0,
      maxTurnoverPerDay: 1
    },
    riskLimits: {
      maxAbsWeight: 1,
      dailyLossStop: 0
    }
  };

  // Define 4 test configurations
  const configs = [
    {
      label: 'Baseline (Phase 1)',
      flags: { useAdaptiveLambda: false, useWeightedPortfolio: false, useNormalization: false }
    },
    {
      label: 'Only Adaptive Lambda',
      flags: { useAdaptiveLambda: true, useWeightedPortfolio: false, useNormalization: false }
    },
    {
      label: 'Only Weighted Portfolio',
      flags: { useAdaptiveLambda: false, useWeightedPortfolio: true, useNormalization: false }
    },
    {
      label: 'Only Normalization',
      flags: { useAdaptiveLambda: false, useWeightedPortfolio: false, useNormalization: true }
    }
  ];

  const results = [];

  for (const cfg of configs) {
    const btConfig = { ...baseConfig };
    // When testing adaptive lambda, the config needs useAdaptiveLambda=true
    // so the PCA module knows to use it
    if (cfg.flags.useAdaptiveLambda) {
      btConfig.useAdaptiveLambda = true;
    }

    console.log(`Running: ${cfg.label}...`);
    const returns = runConfigBacktest(returnsUs, returnsJp, returnsJpOc, btConfig, SECTOR_LABELS, cfg.flags);
    const metrics = computePerformanceMetrics(returns.map(r => r.return));

    results.push({
      label: cfg.label,
      flags: cfg.flags,
      metrics,
      numDays: returns.length
    });
  }

  // Also run the "all enabled" config (current Phase 2 state)
  {
    const btConfig = { ...baseConfig, useAdaptiveLambda: true };
    console.log('Running: All Phase 2 (current)...');
    const returns = runConfigBacktest(returnsUs, returnsJp, returnsJpOc, btConfig, SECTOR_LABELS, {
      useAdaptiveLambda: true,
      useWeightedPortfolio: true,
      useNormalization: true
    });
    const metrics = computePerformanceMetrics(returns.map(r => r.return));
    results.push({
      label: 'All Phase 2 (current)',
      flags: { useAdaptiveLambda: true, useWeightedPortfolio: true, useNormalization: true },
      metrics,
      numDays: returns.length
    });
  }

  // Print comparison table
  console.log('\n');
  console.log('='.repeat(100));
  console.log('PCA_SUB Performance Comparison: Phase 2 Improvement Isolation');
  console.log('='.repeat(100));
  console.log(
    'Configuration'.padEnd(30) +
    'AR (%)'.padStart(10) +
    'RISK (%)'.padStart(10) +
    'R/R'.padStart(8) +
    'MDD (%)'.padStart(10) +
    'Total (%)'.padStart(12) +
    'Days'.padStart(8)
  );
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      r.label.padEnd(30) +
      (r.metrics.AR * 100).toFixed(2).padStart(10) +
      (r.metrics.RISK * 100).toFixed(2).padStart(10) +
      r.metrics.RR.toFixed(2).padStart(8) +
      (r.metrics.MDD * 100).toFixed(2).padStart(10) +
      ((r.metrics.Cumulative - 1) * 100).toFixed(2).padStart(12) +
      String(r.numDays).padStart(8)
    );
  }

  console.log('='.repeat(100));

  // Identify the culprit
  const baseline = results[0];
  console.log('\n--- Analysis ---');
  console.log(`Baseline AR: ${(baseline.metrics.AR * 100).toFixed(2)}%`);
  for (let i = 1; i < results.length - 1; i++) {
    const r = results[i];
    const diff = (r.metrics.AR - baseline.metrics.AR) * 100;
    const direction = diff >= 0 ? 'IMPROVED' : 'DEGRADED';
    console.log(
      `${r.label}: AR = ${(r.metrics.AR * 100).toFixed(2)}% (delta = ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%) [${direction}]`
    );
  }
  const allPhase2 = results[results.length - 1];
  const totalDiff = (allPhase2.metrics.AR - baseline.metrics.AR) * 100;
  console.log(
    `All Phase 2: AR = ${(allPhase2.metrics.AR * 100).toFixed(2)}% (delta = ${totalDiff >= 0 ? '+' : ''}${totalDiff.toFixed(2)}%)`
  );

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
