'use strict';

const fs = require('fs');
const path = require('path');

const { createLogger } = require('../lib/logger');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, applyTransactionCosts, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { fetchOhlcvDateRangeForTickers, buildPaperAlignedReturnRows } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');

const logger = createLogger('WalkForwardOC');

function toCCMap(byTicker) {
  const out = {};
  for (const t of Object.keys(byTicker || {})) {
    const rows = byTicker[t] || [];
    out[t] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (!prev || !cur) continue;
      const p = Number(prev.close);
      const c = Number(cur.close);
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
      const o = Number(r.open);
      const c = Number(r.close);
      const d = String(r.date || '').split('T')[0];
      if (!d || !Number.isFinite(o) || !Number.isFinite(c) || o <= 0 || c <= 0) continue;
      out[t].push({ date: d, return: (c - o) / o });
    }
  }
  return out;
}

async function main() {
  const startDate = config.data.startDate;
  const endDate = config.data.endDate;
  const costs = config.backtest.transactionCosts;
  const exec = config.backtest.execution;
  const stability = config.backtest.stability;

  logger.info('Walk-forward OC validation started', {
    startDate,
    endDate,
    windowLength: config.backtest.windowLength
  });

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvDateRangeForTickers(US_ETF_TICKERS, startDate, endDate, config),
    fetchOhlcvDateRangeForTickers(JP_ETF_TICKERS, startDate, endDate, config)
  ]);

  const usCCMap = toCCMap(usRes.byTicker);
  const jpCCMap = toCCMap(jpRes.byTicker);
  const jpOCMap = toOCMap(jpRes.byTicker);

  const usDateMap = new Map();
  const jpCCDateMap = new Map();
  const jpOCDateMap = new Map();

  for (const t of Object.keys(usCCMap)) {
    for (const r of usCCMap[t]) {
      if (!usDateMap.has(r.date)) usDateMap.set(r.date, {});
      usDateMap.get(r.date)[t] = r.return;
    }
  }
  for (const t of Object.keys(jpCCMap)) {
    for (const r of jpCCMap[t]) {
      if (!jpCCDateMap.has(r.date)) jpCCDateMap.set(r.date, {});
      jpCCDateMap.get(r.date)[t] = r.return;
    }
    for (const r of jpOCMap[t] || []) {
      if (!jpOCDateMap.has(r.date)) jpOCDateMap.set(r.date, {});
      jpOCDateMap.get(r.date)[t] = r.return;
    }
  }

  const { retUs, retJp, retJpOc, dates } = buildPaperAlignedReturnRows(
    usDateMap,
    jpCCDateMap,
    jpOCDateMap,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  if (retUs.length < config.backtest.windowLength + 10) {
    throw new Error(`insufficient aligned rows: ${retUs.length}`);
  }

  const signalGen = new LeadLagSignal({
    nFactors: config.backtest.nFactors,
    lambdaReg: config.backtest.lambdaReg,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });
  const warmup = config.backtest.windowLength;
  let prevWeights = null;
  const returns = [];

  for (let i = warmup; i < retJpOc.length; i++) {
    const windowStart = i - config.backtest.windowLength;
    const retUsWindow = retUs.slice(windowStart, i).map((r) => r.values);
    const retJpWindow = retJp.slice(windowStart, i).map((r) => r.values);
    const retUsLatest = retUs[i - 1].values;
    const CFull = correlationMatrixSample(
      retUsWindow.map((r, k) => [...r, ...retJpWindow[k]])
    );
    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      config.sectorLabels,
      CFull
    );
    let weights = buildPortfolio(signal, config.backtest.quantile);

    const prevForBlend = prevWeights || new Array(weights.length).fill(0);
    const minEdge = Number(stability.minSignalAbs || 0);
    const active = signal.filter((x) => Math.abs(x) >= minEdge).length;
    if (active < Math.max(2, Math.floor(weights.length * 0.2))) {
      weights = prevForBlend.slice();
    } else {
      const t = Math.max(0, Math.min(1, Number(stability.rebalanceBuffer || 0)));
      weights = weights.map((w, idx) => (1 - t) * w + t * prevForBlend[idx]);
    }

    const gross = weights.reduce((s, w) => s + Math.abs(w), 0);
    if (gross > stability.maxGrossExposure && gross > 0) {
      const k = stability.maxGrossExposure / gross;
      weights = weights.map((w) => w * k);
    }
    const per = Math.max(0, stability.maxPositionAbs);
    if (per > 0) {
      weights = weights.map((w) => Math.max(-per, Math.min(per, w)));
    }

    let ret = 0;
    for (let j = 0; j < weights.length; j++) ret += weights[j] * retJpOc[i].values[j];
    ret = applyTransactionCosts(ret, costs, prevWeights, weights);
    if (ret < -exec.dailyLossCut) ret = -exec.dailyLossCut;

    returns.push(ret);
    prevWeights = weights;
  }

  const m = computePerformanceMetrics(returns, config.backtest.annualizationFactor);
  const winRate = returns.filter((r) => r > 0).length / returns.length;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const losses = returns.filter((r) => r < 0).reduce((a, b) => a + Math.abs(b), 0);
  const gains = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const pf = losses > 0 ? gains / losses : Infinity;

  console.log('\n=== Walk-forward (Open->Close) ===');
  console.log(`Period: ${dates[0]} .. ${dates[dates.length - 1]}`);
  console.log(`Trades: ${returns.length}`);
  console.log(`AR: ${(m.AR * 100).toFixed(2)}%`);
  console.log(`RISK: ${(m.RISK * 100).toFixed(2)}%`);
  console.log(`MDD: ${(m.MDD * 100).toFixed(2)}%`);
  console.log(`Total: ${((m.Cumulative - 1) * 100).toFixed(2)}%`);
  console.log(`WinRate: ${(winRate * 100).toFixed(2)}%`);
  console.log(`AvgRet/day: ${(avg * 100).toFixed(3)}%`);
  console.log(`ProfitFactor: ${Number.isFinite(pf) ? pf.toFixed(3) : 'Infinity'}`);

  const outDir = path.resolve(config.data.outputDir || './results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const wfPayload = {
    at: new Date().toISOString(),
    script: 'walkforward_open_to_close',
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    tradeDays: returns.length,
    metrics: {
      AR: m.AR,
      RISK: m.RISK,
      RR: m.RR,
      MDD: m.MDD,
      cumulative: m.Cumulative,
      winRate,
      avgRetPerDay: avg,
      profitFactor: Number.isFinite(pf) ? pf : null
    }
  };
  fs.writeFileSync(
    path.join(outDir, 'walkforward_oc_summary.json'),
    JSON.stringify(wfPayload, null, 2),
    'utf8'
  );
  console.log(`\nWrote ${path.join(outDir, 'walkforward_oc_summary.json')}`);
}

main().catch((e) => {
  logger.error('Walk-forward failed', { error: e.message, stack: e.stack });
  process.exit(1);
});
