#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { config } = require('../lib/config');
const { fetchOhlcvForTickers, buildReturnMatricesFromOhlcv } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { correlationMatrixSample } = require('../lib/math');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');

function parseNumberEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function buildProfileConfig(baseConfig, profile) {
  return {
    ...baseConfig,
    data: {
      ...baseConfig.data,
      mode: profile.jpMode,
      usOhlcvProvider: profile.usProvider,
      strictSourceMode: false
    }
  };
}

function summarizeSourcePaths(sources) {
  const counts = {};
  for (const src of Object.values(sources || {})) {
    counts[src] = (counts[src] || 0) + 1;
  }
  return counts;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function compareCloseParity(aByTicker, bByTicker, tickers) {
  const perTicker = {};
  let allAbsPctDiff = [];

  for (const t of tickers) {
    const aMap = new Map((aByTicker[t] || []).map((r) => [r.date, r]));
    const bMap = new Map((bByTicker[t] || []).map((r) => [r.date, r]));
    const commonDates = Array.from(aMap.keys()).filter((d) => bMap.has(d)).sort();
    const diffs = [];

    for (const d of commonDates) {
      const a = aMap.get(d);
      const b = bMap.get(d);
      if (!a || !b || !Number.isFinite(a.close) || !Number.isFinite(b.close) || a.close <= 0 || b.close <= 0) continue;
      const pct = Math.abs((a.close - b.close) / b.close) * 100;
      diffs.push(pct);
      allAbsPctDiff.push(pct);
    }

    const sorted = diffs.slice().sort((x, y) => x - y);
    perTicker[t] = {
      overlapDays: sorted.length,
      meanAbsPctDiff: sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : null,
      p95AbsPctDiff: percentile(sorted, 0.95),
      maxAbsPctDiff: sorted.length ? sorted[sorted.length - 1] : null
    };
  }

  const allSorted = allAbsPctDiff.slice().sort((x, y) => x - y);
  return {
    overall: {
      overlapPoints: allSorted.length,
      meanAbsPctDiff: allSorted.length ? allSorted.reduce((s, x) => s + x, 0) / allSorted.length : null,
      p95AbsPctDiff: percentile(allSorted, 0.95),
      maxAbsPctDiff: allSorted.length ? allSorted[allSorted.length - 1] : null
    },
    perTicker
  };
}

function computeLongShortMetrics(retUs, retJp, retJpOc, opts) {
  const { windowLength, nFactors, lambdaReg, quantile, orderedSectorKeys, sectorLabels } = opts;
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  const signalGen = new LeadLagSignal({ windowLength, nFactors, lambdaReg, quantile, orderedSectorKeys });
  const returns = [];

  for (let i = windowLength; i < retJpOc.length; i++) {
    const s = i - windowLength;
    const signal = signalGen.computeSignal(
      retUs.slice(s, i).map((r) => r.values),
      retJp.slice(s, i).map((r) => r.values),
      retUs[i - 1].values,
      sectorLabels,
      CFull
    );
    const w = buildPortfolio(signal, quantile);
    let r = 0;
    for (let k = 0; k < w.length; k++) r += w[k] * retJpOc[i].values[k];
    returns.push(r);
  }

  const m = computePerformanceMetrics(returns);
  return {
    tradedDays: returns.length,
    AR: m.AR * 100,
    RISK: m.RISK * 100,
    RR: m.RR,
    MDD: m.MDD * 100,
    CumulativePct: (m.Cumulative - 1) * 100
  };
}

async function run() {
  const chartDays = parseNumberEnv('PARITY_CHART_DAYS', 1200);
  const windowLength = parseNumberEnv('PARITY_WINDOW_LENGTH', 60);
  const lambdaReg = parseNumberEnv('PARITY_LAMBDA_REG', 0.9);
  const quantile = parseNumberEnv('PARITY_QUANTILE', 0.4);
  const nFactors = parseNumberEnv('PARITY_N_FACTORS', config.backtest.nFactors || 3);

  const profileA = {
    id: process.env.PARITY_A_ID || 'a_yahoo_yahoo',
    jpMode: process.env.PARITY_A_JP_MODE || 'yahoo',
    usProvider: process.env.PARITY_A_US_PROVIDER || 'yahoo'
  };
  const profileB = {
    id: process.env.PARITY_B_ID || 'b_jquants_alphavantage',
    jpMode: process.env.PARITY_B_JP_MODE || 'jquants',
    usProvider: process.env.PARITY_B_US_PROVIDER || 'alphavantage'
  };

  const usTickers = US_ETF_TICKERS;
  const jpTickers = JP_ETF_TICKERS;
  const orderedSectorKeys = [...usTickers.map((t) => `US_${t}`), ...jpTickers.map((t) => `JP_${t}`)];

  const cfgA = buildProfileConfig(config, profileA);
  const cfgB = buildProfileConfig(config, profileB);

  const [aUs, aJp, bUs, bJp] = await Promise.all([
    fetchOhlcvForTickers(usTickers, chartDays, cfgA),
    fetchOhlcvForTickers(jpTickers, chartDays, cfgA),
    fetchOhlcvForTickers(usTickers, chartDays, cfgB),
    fetchOhlcvForTickers(jpTickers, chartDays, cfgB)
  ]);

  const aRet = buildReturnMatricesFromOhlcv(aUs.byTicker, aJp.byTicker, usTickers, jpTickers, config.backtest.jpWindowReturn);
  const bRet = buildReturnMatricesFromOhlcv(bUs.byTicker, bJp.byTicker, usTickers, jpTickers, config.backtest.jpWindowReturn);

  const metricsA = computeLongShortMetrics(aRet.retUs, aRet.retJp, aRet.retJpOc, {
    windowLength,
    nFactors,
    lambdaReg,
    quantile,
    orderedSectorKeys,
    sectorLabels: config.sectorLabels
  });
  const metricsB = computeLongShortMetrics(bRet.retUs, bRet.retJp, bRet.retJpOc, {
    windowLength,
    nFactors,
    lambdaReg,
    quantile,
    orderedSectorKeys,
    sectorLabels: config.sectorLabels
  });

  const parityUs = compareCloseParity(aUs.byTicker, bUs.byTicker, usTickers);
  const parityJp = compareCloseParity(aJp.byTicker, bJp.byTicker, jpTickers);

  const report = {
    generatedAt: new Date().toISOString(),
    params: { chartDays, windowLength, lambdaReg, quantile, nFactors },
    profiles: {
      A: profileA,
      B: profileB
    },
    sourceSummary: {
      A: {
        us: summarizeSourcePaths(aUs.sources),
        jp: summarizeSourcePaths(aJp.sources),
        usErrors: aUs.errors,
        jpErrors: aJp.errors
      },
      B: {
        us: summarizeSourcePaths(bUs.sources),
        jp: summarizeSourcePaths(bJp.sources),
        usErrors: bUs.errors,
        jpErrors: bJp.errors
      }
    },
    coverage: {
      A: {
        alignedDays: aRet.dates.length,
        period: { start: aRet.dates[0] || null, end: aRet.dates[aRet.dates.length - 1] || null }
      },
      B: {
        alignedDays: bRet.dates.length,
        period: { start: bRet.dates[0] || null, end: bRet.dates[bRet.dates.length - 1] || null }
      }
    },
    closeParity: {
      us: parityUs.overall,
      jp: parityJp.overall
    },
    strategyLongShort: {
      A: metricsA,
      B: metricsB,
      delta_B_minus_A: {
        AR: metricsB.AR - metricsA.AR,
        RISK: metricsB.RISK - metricsA.RISK,
        RR: metricsB.RR - metricsA.RR,
        MDD: metricsB.MDD - metricsA.MDD,
        CumulativePct: metricsB.CumulativePct - metricsA.CumulativePct
      }
    }
  };

  const outDir = path.resolve(config.data.outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'data_source_parity_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({ outPath, report }, null, 2));
}

if (require.main === module) {
  run().catch((e) => {
    console.error('[data_source_parity]', e);
    process.exit(1);
  });
}

module.exports = {
  run
};

