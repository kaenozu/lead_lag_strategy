'use strict';

/**
 * 画面の「買い候補」に相当する銘柄だけを等金額ロングし、
 * その日本取引日の OC（始値→終値）リターンで損益を積むシミュレーション。
 *
 * 注意:
 * - 標準の npm run backtest（PCA_SUB 等）はロング・ショート両建て想定で別物です。
 * - 実際の寄り付き・約定・手数料・税と一致しません（.env の BACKTEST_* コストのみ）。
 */

const fs = require('fs');
const path = require('path');

const { createLogger } = require('../lib/logger');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, applyTransactionCosts, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { fetchOhlcvDateRangeForTickers, buildPaperAlignedReturnRows } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');

const logger = createLogger('LongOnlyOC');

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

  logger.info('Long-only OC (buy candidates, same-day close) backtest', {
    startDate,
    endDate,
    windowLength: config.backtest.windowLength,
    quantile: config.backtest.quantile
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
    const fullW = buildPortfolio(signal, config.backtest.quantile);
    const weights = fullW.map((w) => Math.max(0, w));

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

  console.log('\n=== 買い候補のみ・同日 OC（始値→終値）シミュレーション ===');
  console.log('（ロングショート版のバックテストとは別系列です）');
  console.log(`期間: ${dates[warmup]} .. ${dates[dates.length - 1]}`);
  console.log(`営業日数: ${returns.length}`);
  console.log(`年率リターン AR: ${(m.AR * 100).toFixed(2)}%`);
  console.log(`年率ボラ RISK: ${(m.RISK * 100).toFixed(2)}%`);
  console.log(`最大 DD: ${(m.MDD * 100).toFixed(2)}%`);
  console.log(`累積（複利）: ${((m.Cumulative - 1) * 100).toFixed(2)}%`);
  console.log(`勝率: ${(winRate * 100).toFixed(2)}%`);
  console.log(`1 日平均: ${(avg * 100).toFixed(3)}%`);
  console.log(`ProfitFactor: ${Number.isFinite(pf) ? pf.toFixed(3) : 'Infinity'}`);
  console.log(
    `\n金額イメージ: 元本 100 万円なら累積損益 ≈ ${(1000000 * (m.Cumulative - 1)).toLocaleString('ja-JP')} 円（税・実際の約定は未反映）`
  );

  const outDir = path.resolve(config.data.outputDir || './results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    at: new Date().toISOString(),
    script: 'long_only_oc',
    description: 'Long-only equal weight on buy quantile; JP open-to-close return same day',
    periodStart: dates[warmup],
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
    },
    notionals: {
      initialJPY: 1000000,
      approxPnlJPY: Math.round(1000000 * (m.Cumulative - 1))
    }
  };
  fs.writeFileSync(
    path.join(outDir, 'long_only_oc_summary.json'),
    JSON.stringify(payload, null, 2),
    'utf8'
  );
  console.log(`\n保存: ${path.join(outDir, 'long_only_oc_summary.json')}`);
}

main().catch((e) => {
  logger.error('Long-only OC backtest failed', { error: e.message, stack: e.stack });
  process.exit(1);
});
