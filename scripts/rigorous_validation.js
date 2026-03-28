'use strict';

const fs = require('fs');
const path = require('path');

const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, computePerformanceMetrics, applyTransactionCosts } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { fetchOhlcvDateRangeForTickers } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');
const { buildReturnMatricesFromOhlcv, computeCFull } = require('../backtest/common');
const { weightedReturn, averageMomentumWindow } = require('../lib/backtestUtils');
const { createLogger } = require('../lib/logger');

const logger = createLogger('RigorousValidation');

function runStrategy(returnsUs, returnsJp, returnsJpOc, params, CFull, startIdx, endIdx) {
  const nJp = returnsJpOc[0].values.length;
  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg,
    nFactors: params.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });
  let prevWeights = null;
  const dailyReturns = [];

  for (let i = startIdx; i < endIdx && i < returnsJpOc.length; i++) {
    const windowStart = i - params.windowLength;
    if (windowStart < 0) continue;

    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
    const retUsLatest = returnsUs[i - 1].values;

    const signal = signalGen.computeSignal(retUsWindow, retJpWindow, retUsLatest, SECTOR_LABELS, CFull);
    const weights = buildPortfolio(signal, params.quantile);

    let ret = weightedReturn(weights, returnsJpOc[i].values);
    ret = applyTransactionCosts(ret, { slippage: 0, commission: 0 }, prevWeights, weights);
    prevWeights = weights;
    dailyReturns.push(ret);
  }
  return dailyReturns;
}

function summarize(returns, label) {
  if (returns.length < 10) return null;
  const m = computePerformanceMetrics(returns);
  const wins = returns.filter(r => r > 0).length;
  const losses = returns.filter(r => r < 0).length;
  const avgWin = wins > 0 ? returns.filter(r => r > 0).reduce((a, b) => a + b, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0) / losses) : 0;
  return {
    label,
    AR: m.AR * 100,
    RISK: m.RISK * 100,
    RR: m.RR,
    MDD: m.MDD * 100,
    Total: (m.Cumulative - 1) * 100,
    WinRate: wins / returns.length * 100,
    ProfitFactor: avgLoss > 0 ? avgWin / avgLoss : Infinity,
    Days: returns.length
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('Rigorous Walk-Forward Validation');
  console.log('='.repeat(80));

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvDateRangeForTickers(US_ETF_TICKERS, config.data.startDate, config.data.endDate, config),
    fetchOhlcvDateRangeForTickers(JP_ETF_TICKERS, config.data.startDate, config.data.endDate, config)
  ]);

  const { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(usRes.byTicker, jpRes.byTicker, 'cc');
  const totalDays = dates.length;
  console.log(`Data: ${dates[0]} ~ ${dates[dates.length - 1]} (${totalDays} trading days)`);

  const CFull = computeCFull(retUs, retJp);

  const paramsList = [
    { lambdaReg: 0.95, nFactors: 3, quantile: 0.40, windowLength: 60, label: 'PCA-SUB-0.95-Q40' },
    { lambdaReg: 0.90, nFactors: 3, quantile: 0.40, windowLength: 60, label: 'PCA-SUB-0.90-Q40' },
    { lambdaReg: 0.80, nFactors: 3, quantile: 0.45, windowLength: 60, label: 'PCA-SUB-0.80-Q45(old)' },
    { lambdaReg: 0.99, nFactors: 3, quantile: 0.40, windowLength: 60, label: 'PCA-SUB-0.99-Q40' },
    { lambdaReg: 0.95, nFactors: 1, quantile: 0.40, windowLength: 60, label: 'PCA-SUB-0.95-Q40-K1' }
  ];

  const warmup = 60;
  const trainDays = 504;
  const testDays = 126;
  const stepDays = 126;

  console.log('\n' + '='.repeat(80));
  console.log('Test 1: Full Period (In-Sample)');
  console.log('='.repeat(80));
  console.log('Strategy'.padEnd(25) + 'AR%'.padStart(8) + 'Risk%'.padStart(8) + 'R/R'.padStart(8) + 'MDD%'.padStart(8) + 'Total%'.padStart(10) + 'Win%'.padStart(8) + 'PF'.padStart(8));
  console.log('-'.repeat(83));

  const fullResults = [];
  for (const p of paramsList) {
    const rets = runStrategy(retUs, retJp, retJpOc, p, CFull, warmup, totalDays);
    const s = summarize(rets, p.label);
    if (s) {
      fullResults.push(s);
      console.log(
        s.label.padEnd(25) +
        s.AR.toFixed(2).padStart(8) +
        s.RISK.toFixed(2).padStart(8) +
        s.RR.toFixed(2).padStart(8) +
        s.MDD.toFixed(2).padStart(8) +
        s.Total.toFixed(2).padStart(10) +
        s.WinRate.toFixed(1).padStart(8) +
        (Number.isFinite(s.ProfitFactor) ? s.ProfitFactor.toFixed(2) : 'Inf').padStart(8)
      );
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Test 2: Walk-Forward (Out-of-Sample)');
  console.log('='.repeat(80));
  console.log(`Train: ${trainDays} days, Test: ${testDays} days, Step: ${stepDays} days`);

  for (const p of paramsList) {
    console.log('\n--- ' + p.label + ' ---');
    console.log('Period'.padEnd(12) + 'Type'.padEnd(8) + 'AR%'.padStart(8) + 'Risk%'.padStart(8) + 'R/R'.padStart(8) + 'MDD%'.padStart(8) + 'Total%'.padStart(10) + 'Days'.padStart(6));
    console.log('-'.repeat(70));

    const trainReturns = [];
    const testReturns = [];
    let period = 0;

    for (let start = warmup; start + trainDays + testDays <= totalDays; start += stepDays) {
      period++;
      const trainEnd = start + trainDays;
      const testEnd = Math.min(trainEnd + testDays, totalDays);

      const tr = runStrategy(retUs, retJp, retJpOc, p, CFull, start, trainEnd);
      const te = runStrategy(retUs, retJp, retJpOc, p, CFull, trainEnd, testEnd);

      const ts = summarize(tr, 'train');
      const es = summarize(te, 'test');
      if (ts) trainReturns.push(...tr);
      if (es) testReturns.push(...te);

      if (ts) console.log(`P${period}`.padEnd(12) + 'train'.padEnd(8) + ts.AR.toFixed(2).padStart(8) + ts.RISK.toFixed(2).padStart(8) + ts.RR.toFixed(2).padStart(8) + ts.MDD.toFixed(2).padStart(8) + ts.Total.toFixed(2).padStart(10) + String(ts.Days).padStart(6));
      if (es) console.log(''.padEnd(12) + 'test'.padEnd(8) + es.AR.toFixed(2).padStart(8) + es.RISK.toFixed(2).padStart(8) + es.RR.toFixed(2).padStart(8) + es.MDD.toFixed(2).padStart(8) + es.Total.toFixed(2).padStart(10) + String(es.Days).padStart(6));
    }

    const trainAgg = summarize(trainReturns, 'train-agg');
    const testAgg = summarize(testReturns, 'test-agg');

    console.log('-'.repeat(70));
    if (trainAgg) console.log('AGG TRAIN'.padEnd(20) + trainAgg.AR.toFixed(2).padStart(8) + trainAgg.RISK.toFixed(2).padStart(8) + trainAgg.RR.toFixed(2).padStart(8) + trainAgg.MDD.toFixed(2).padStart(8) + trainAgg.Total.toFixed(2).padStart(10) + String(trainAgg.Days).padStart(6));
    if (testAgg) console.log('AGG TEST (OOS)'.padEnd(20) + testAgg.AR.toFixed(2).padStart(8) + testAgg.RISK.toFixed(2).padStart(8) + testAgg.RR.toFixed(2).padStart(8) + testAgg.MDD.toFixed(2).padStart(8) + testAgg.Total.toFixed(2).padStart(10) + String(testAgg.Days).padStart(6));

    if (trainAgg && testAgg) {
      const decay = testAgg.AR / (trainAgg.AR || 0.01);
      const verdict = decay > 0.5 ? 'GOOD' : decay > 0 ? 'WEAK' : 'BAD';
      console.log(`Decay ratio (OOS/IS): ${decay.toFixed(2)} => ${verdict}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Test 3: First Half vs Second Half Split');
  console.log('='.repeat(80));
  const mid = Math.floor(totalDays / 2);

  for (const p of paramsList) {
    const r1 = summarize(runStrategy(retUs, retJp, retJpOc, p, CFull, warmup, mid), p.label + ' 1st');
    const r2 = summarize(runStrategy(retUs, retJp, retJpOc, p, CFull, mid, totalDays), p.label + ' 2nd');
    if (r1 && r2) {
      console.log(`${p.label}: 1st AR=${r1.AR.toFixed(2)}% / MDD=${r1.MDD.toFixed(2)}%  |  2nd AR=${r2.AR.toFixed(2)}% / MDD=${r2.MDD.toFixed(2)}%`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Done.');
}

main().catch(e => { logger.error('Failed', { error: e.message, stack: e.stack }); process.exit(1); });
