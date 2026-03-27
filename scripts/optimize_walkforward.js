/**
 * scripts/optimize_walkforward.js
 *
 * Walk-forward grid search for optimal PCA SUB parameters.
 * Rolling C_full (no lookahead bias), transaction costs included.
 * Pre-computes CFull per day for speed.
 *
 * Usage: node scripts/optimize_walkforward.js
 */

'use strict';

process.env.LOG_LEVEL = 'error';

const fs = require('fs');
const path = require('path');

const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, applyTransactionCosts, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { fetchOhlcvDateRangeForTickers, buildPaperAlignedReturnRows } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');

const PARAM_GRID = {
  windowLength: [40, 50, 60, 80],
  lambdaReg: [0.85, 0.9, 0.95, 1.0],
  quantile: [0.3, 0.35, 0.4, 0.45],
  nFactors: [2, 3, 4],
  useAdaptiveLambda: [false, true],
  useEwma: [false, true]
};

const COSTS = { slippage: 0.0005, commission: 0.0003 };

function toCCMap(byTicker) {
  const out = {};
  for (const t of Object.keys(byTicker || {})) {
    const rows = byTicker[t] || [];
    out[t] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]; const cur = rows[i];
      if (!prev || !cur) continue;
      const p = Number(prev.close); const c = Number(cur.close);
      const d = String(cur.date || '').split('T')[0];
      if (!d || !Number.isFinite(p) || !Number.isFinite(c) || p <= 0 || c <= 0) continue;
      out[t].push({ date: d, return: (c - p) / p });
    }
  }
  return out;
}

function toOCMap(byTicker) {
  const out = {};
  for (const t of Object.keys(byTicker || {})) {
    const rows = byTicker[t] || [];
    out[t] = [];
    for (const r of rows) {
      const o = Number(r.open); const c = Number(r.close);
      const d = String(r.date || '').split('T')[0];
      if (!d || !Number.isFinite(o) || !Number.isFinite(c) || o <= 0 || c <= 0) continue;
      out[t].push({ date: d, return: (c - o) / o });
    }
  }
  return out;
}

function generateCombinations(grid) {
  const keys = Object.keys(grid);
  const result = [];
  function recurse(idx, current) {
    if (idx === keys.length) { result.push({ ...current }); return; }
    for (const val of grid[keys[idx]]) { current[keys[idx]] = val; recurse(idx + 1, current); }
  }
  recurse(0, {});
  return result;
}

async function main() {
  const t0 = Date.now();
  const total = Object.values(PARAM_GRID).reduce((a, v) => a * v.length, 1);

  console.log(`Walk-forward grid search: ${total} combinations`);
  console.log(`Transaction costs: slippage=${COSTS.slippage}, commission=${COSTS.commission} (8bps round-trip)`);

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvDateRangeForTickers(US_ETF_TICKERS, config.data.startDate, config.data.endDate, config),
    fetchOhlcvDateRangeForTickers(JP_ETF_TICKERS, config.data.startDate, config.data.endDate, config)
  ]);

  const usCCMap = toCCMap(usRes.byTicker);
  const jpCCMap = toCCMap(jpRes.byTicker);
  const jpOCMap = toOCMap(jpRes.byTicker);

  const usDateMap = new Map(); const jpCCDateMap = new Map(); const jpOCDateMap = new Map();
  for (const t of Object.keys(usCCMap)) {
    for (const r of usCCMap[t]) { if (!usDateMap.has(r.date)) usDateMap.set(r.date, {}); usDateMap.get(r.date)[t] = r.return; }
  }
  for (const t of Object.keys(jpCCMap)) {
    for (const r of jpCCMap[t]) { if (!jpCCDateMap.has(r.date)) jpCCDateMap.set(r.date, {}); jpCCDateMap.get(r.date)[t] = r.return; }
    for (const r of jpOCMap[t] || []) { if (!jpOCDateMap.has(r.date)) jpOCDateMap.set(r.date, {}); jpOCDateMap.get(r.date)[t] = r.return; }
  }

  const { retUs, retJp, retJpOc, dates } = buildPaperAlignedReturnRows(
    usDateMap, jpCCDateMap, jpOCDateMap, US_ETF_TICKERS, JP_ETF_TICKERS, config.backtest.jpWindowReturn
  );

  const nJp = retJpOc[0].values.length;
  const nUs = retUs[0].values.length;
  console.log(`Data: ${dates[0]} .. ${dates[dates.length - 1]} (${dates.length} days, ${nUs} US + ${nJp} JP)`);
  console.log('');

  const maxWin = 80;
  console.log('Pre-computing CFull matrices...');

  const cFullCache = new Map();
  for (let w = 40; w <= maxWin; w += 10) {
    cFullCache.set(w, []);
  }

  for (let i = maxWin; i < retJpOc.length; i++) {
    for (const w of cFullCache.keys()) {
      if (i < w) continue;
      const start = i - w;
      const combined = new Array(w);
      for (let k = 0; k < w; k++) {
        combined[k] = new Array(nUs + nJp);
        for (let j = 0; j < nUs; j++) combined[k][j] = retUs[start + k].values[j];
        for (let j = 0; j < nJp; j++) combined[k][nUs + j] = retJp[start + k].values[j];
      }
      cFullCache.get(w).push(correlationMatrixSample(combined));
    }
    if ((i - maxWin) % 200 === 0) {
      process.stdout.write(`  [${i}/${retJpOc.length}]\r`);
    }
  }
  console.log(`  CFull cache ready (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const combinations = generateCombinations(PARAM_GRID);
  const results = [];
  let count = 0;

  const origWarn = console.warn;
  console.warn = () => {};

  for (const params of combinations) {
    count++;
    const w = params.windowLength;
    const warmup = w;
    if (retJpOc.length < warmup + 10) continue;

    const signalGen = new LeadLagSignal({
      nFactors: params.nFactors,
      lambdaReg: params.lambdaReg,
      orderedSectorKeys: config.pca.orderedSectorKeys,
      useEwma: params.useEwma,
      useAdaptiveLambda: params.useAdaptiveLambda
    });

    const cFullList = cFullCache.get(w);
    let prevWeights = null;
    const returns = [];

    for (let i = warmup; i < retJpOc.length; i++) {
      const cIdx = i - warmup;
      if (cIdx >= cFullList.length) break;

      const windowStart = i - w;
      const retUsWindow = retUs.slice(windowStart, i).map(r => r.values);
      const retJpWindow = retJp.slice(windowStart, i).map(r => r.values);
      const retUsLatest = retUs[i - 1].values;
      const CFull = cFullList[cIdx];

      try {
        const signal = signalGen.computeSignal(retUsWindow, retJpWindow, retUsLatest, config.sectorLabels, CFull);
        const weights = buildPortfolio(signal, params.quantile);
        let ret = 0;
        for (let j = 0; j < nJp; j++) ret += weights[j] * retJpOc[i].values[j];
        ret = applyTransactionCosts(ret, COSTS, prevWeights, weights);
        returns.push(ret);
        prevWeights = weights;
      } catch {
        returns.push(0);
        prevWeights = null;
      }
    }

    if (returns.length < 50) continue;

    const m = computePerformanceMetrics(returns, 252);
    results.push({
      windowLength: w, lambdaReg: params.lambdaReg, quantile: params.quantile,
      nFactors: params.nFactors, useAdaptiveLambda: params.useAdaptiveLambda, useEwma: params.useEwma,
      AR: m.AR, RISK: m.RISK, RR: m.RR, MDD: m.MDD, Cumulative: m.Cumulative, trades: returns.length
    });

    if (count % 64 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const rate = (count / ((Date.now() - t0) / 1000)).toFixed(1);
      const eta = ((total - count) / rate / 60).toFixed(1);
      process.stdout.write(`  [${count}/${total}] ${elapsed}s, ${rate}/s, ETA ${eta}min\r`);
    }
  }

  console.warn = origWarn;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  Done: ${results.length} valid / ${total} total in ${elapsed}s`);

  results.sort((a, b) => b.AR - a.AR);

  console.log('\n' + '='.repeat(100));
  console.log('TOP 20 by Annual Return (AR)');
  console.log('='.repeat(100));
  console.log(
    'Rank'.padStart(4) + 'AR(%)'.padStart(9) + 'Risk(%)'.padStart(9) + 'R/R'.padStart(8) +
    'MDD(%)'.padStart(9) + 'Total(%)'.padStart(10) + 'Trades'.padStart(7) +
    'q'.padStart(6) + 'f'.padStart(4) + 'lambda'.padStart(7) + 'Win'.padStart(4) +
    'Adapt'.padStart(6) + 'EWMA'.padStart(6)
  );
  console.log('-'.repeat(100));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    console.log(
      String(i + 1).padStart(4) + (r.AR * 100).toFixed(2).padStart(9) + (r.RISK * 100).toFixed(2).padStart(9) +
      r.RR.toFixed(2).padStart(8) + (r.MDD * 100).toFixed(2).padStart(9) + ((r.Cumulative - 1) * 100).toFixed(2).padStart(10) +
      String(r.trades).padStart(7) + r.quantile.toFixed(2).padStart(6) + String(r.nFactors).padStart(4) +
      r.lambdaReg.toFixed(2).padStart(7) + String(r.windowLength).padStart(4) +
      String(r.useAdaptiveLambda).padStart(6) + String(r.useEwma).padStart(6)
    );
  }

  console.log('\n' + '='.repeat(100));
  console.log('TOP 5 by Risk-Return Ratio (AR > 0)');
  console.log('='.repeat(100));
  const positiveAR = results.filter(r => r.AR > 0).sort((a, b) => b.RR - a.RR);
  for (let i = 0; i < Math.min(5, positiveAR.length); i++) {
    const r = positiveAR[i];
    console.log(
      `#${i + 1} AR=${(r.AR * 100).toFixed(2)}% Risk=${(r.RISK * 100).toFixed(2)}% R/R=${r.RR.toFixed(3)} MDD=${(r.MDD * 100).toFixed(2)}% ` +
      `q=${r.quantile} f=${r.nFactors} lambda=${r.lambdaReg} W=${r.windowLength} adapt=${r.useAdaptiveLambda} ewma=${r.useEwma}`
    );
  }

  const outDir = path.resolve(config.data.outputDir || './results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const header = 'windowLength,lambdaReg,quantile,nFactors,useAdaptiveLambda,useEwma,AR,RISK,RR,MDD,Cumulative,trades';
  const csv = header + '\n' + results.map(r =>
    `${r.windowLength},${r.lambdaReg},${r.quantile},${r.nFactors},${r.useAdaptiveLambda},${r.useEwma},${r.AR},${r.RISK},${r.RR},${r.MDD},${r.Cumulative},${r.trades}`
  ).join('\n');
  const outPath = path.join(outDir, 'optimize_walkforward_results.csv');
  fs.writeFileSync(outPath, csv, 'utf8');
  console.log(`\nSaved: ${outPath} (${results.length} combinations)`);
}

main().catch(e => { console.error('Optimization failed:', e.message); process.exit(1); });
