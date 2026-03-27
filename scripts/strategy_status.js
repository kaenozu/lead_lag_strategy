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

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
}

function parseNumberEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

async function runValidation() {
  const chartDays = parseNumberEnv('BACKTEST_CHART_DAYS', 6000);
  const windowLength = parseNumberEnv('WEEKLY_WINDOW_LENGTH', 60);
  const lambdaReg = parseNumberEnv('WEEKLY_LAMBDA_REG', 0.9);
  const quantile = parseNumberEnv('WEEKLY_QUANTILE', 0.4);
  const nFactors = parseNumberEnv('WEEKLY_N_FACTORS', config.backtest.nFactors || 3);

  // 論文再現寄り: 実効開始を 2018 に縛る XLC/XLRE を除外
  const usTickers = US_ETF_TICKERS.filter((t) => !['XLC', 'XLRE'].includes(t));
  const orderedSectorKeys = [...usTickers.map((t) => `US_${t}`), ...JP_ETF_TICKERS.map((t) => `JP_${t}`)];

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(usTickers, chartDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, chartDays, config)
  ]);

  const { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
    usRes.byTicker,
    jpRes.byTicker,
    usTickers,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  const signalGen = new LeadLagSignal({
    windowLength,
    nFactors,
    lambdaReg,
    quantile,
    orderedSectorKeys
  });

  const barsByTicker = {};
  for (const t of JP_ETF_TICKERS) {
    const m = new Map();
    for (const row of jpRes.byTicker[t] || []) m.set(row.date, row);
    barsByTicker[t] = m;
  }

  const buyCountAll = Math.max(1, Math.floor(JP_ETF_TICKERS.length * quantile));
  const daily = {
    top1: [],
    top3: [],
    all_buy_candidates: [],
    long_short: []
  };

  for (let i = windowLength; i < retJpOc.length; i++) {
    const start = i - windowLength;
    const retUsWin = retUs.slice(start, i).map((r) => r.values);
    const retJpWin = retJp.slice(start, i).map((r) => r.values);
    const signal = signalGen.computeSignal(
      retUsWin,
      retJpWin,
      retUs[i - 1].values,
      config.sectorLabels,
      CFull
    );
    const ranked = signal.map((v, idx) => ({ v, idx })).sort((a, b) => b.v - a.v);
    const date = retJpOc[i].date;

    const picksTop1 = ranked.slice(0, 1).map((x) => x.idx);
    const picksTop3 = ranked.slice(0, 3).map((x) => x.idx);
    const picksAll = ranked.slice(0, buyCountAll).map((x) => x.idx);

    const sumYen = (idxs) =>
      idxs.reduce((s, idx) => {
        const b = barsByTicker[JP_ETF_TICKERS[idx]].get(date);
        if (b && Number.isFinite(b.open) && Number.isFinite(b.close) && b.open > 0) {
          return s + (b.close - b.open);
        }
        return s;
      }, 0);

    const avgRet = (idxs) => mean(idxs.map((idx) => retJpOc[i].values[idx]));

    daily.top1.push({ date, yen: sumYen(picksTop1), ret: avgRet(picksTop1) });
    daily.top3.push({ date, yen: sumYen(picksTop3), ret: avgRet(picksTop3) });
    daily.all_buy_candidates.push({ date, yen: sumYen(picksAll), ret: avgRet(picksAll) });

    const w = buildPortfolio(signal, quantile);
    let ls = 0;
    for (let k = 0; k < w.length; k++) ls += w[k] * retJpOc[i].values[k];
    daily.long_short.push({ date, ret: ls });
  }

  const horizons = [
    { id: '3m', days: 63 },
    { id: '6m', days: 126 },
    { id: '1y', days: 252 },
    { id: 'all', days: Infinity }
  ];

  function summarizeYen(arr, horizon) {
    const s = Number.isFinite(horizon.days) ? arr.slice(-horizon.days) : arr;
    const n = s.length;
    const yen = s.reduce((a, b) => a + b.yen, 0);
    const hit = s.filter((x) => x.yen > 0).length;
    const cum = s.reduce((c, x) => c * (1 + x.ret), 1);
    return {
      days: n,
      totalProfitYen: Math.round(yen),
      hitRatePct: pct(hit, n),
      cumulativeReturnPct: Math.round((cum - 1) * 10000) / 100
    };
  }

  function summarizeLongShort(arr, horizon) {
    const s = Number.isFinite(horizon.days) ? arr.slice(-horizon.days) : arr;
    const m = computePerformanceMetrics(s.map((x) => x.ret));
    return {
      days: s.length,
      AR: Math.round(m.AR * 10000) / 100,
      RISK: Math.round(m.RISK * 10000) / 100,
      RR: Math.round(m.RR * 1000) / 1000,
      MDD: Math.round(m.MDD * 10000) / 100,
      CumulativePct: Math.round((m.Cumulative - 1) * 10000) / 100
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'paper_reproduction_universe_minus_xlc_xlre',
    period: {
      start: dates[0],
      end: dates[dates.length - 1]
    },
    params: { chartDays, windowLength, lambdaReg, quantile, nFactors, buyCountAll },
    strategies: {
      top1: {},
      top3: {},
      all_buy_candidates: {},
      long_short: {}
    }
  };

  for (const h of horizons) {
    report.strategies.top1[h.id] = summarizeYen(daily.top1, h);
    report.strategies.top3[h.id] = summarizeYen(daily.top3, h);
    report.strategies.all_buy_candidates[h.id] = summarizeYen(daily.all_buy_candidates, h);
    report.strategies.long_short[h.id] = summarizeLongShort(daily.long_short, h);
  }

  // 週次 GO/STOP 判定（環境変数で閾値調整可）
  const gate = {
    minRR6m: parseNumberEnv('WEEKLY_GATE_MIN_RR_6M', 0),
    minCumulative6mPct: parseNumberEnv('WEEKLY_GATE_MIN_CUM_6M_PCT', 0),
    maxMdd6mPct: parseNumberEnv('WEEKLY_GATE_MAX_MDD_6M_PCT', -20)
  };

  const ls6m = report.strategies.long_short['6m'];
  const checks = {
    rr6mPass: ls6m.RR >= gate.minRR6m,
    cumulative6mPass: ls6m.CumulativePct >= gate.minCumulative6mPct,
    mdd6mPass: ls6m.MDD >= gate.maxMdd6mPct
  };
  const allPass = Object.values(checks).every(Boolean);

  const status = {
    generatedAt: report.generatedAt,
    decision: allPass ? 'GO' : 'STOP',
    checks,
    gate,
    keyMetrics: {
      longShort6m: ls6m,
      longShort3m: report.strategies.long_short['3m'],
      longShort1y: report.strategies.long_short['1y']
    }
  };

  const outputDir = path.resolve(config.data.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'strategy_validation_report.json');
  const statusPath = path.join(outputDir, 'strategy_validation_status.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  console.log(JSON.stringify({ reportPath, statusPath, status }, null, 2));
  return allPass ? 0 : 1;
}

if (require.main === module) {
  runValidation()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('[strategy_status]', e);
      process.exit(1);
    });
}

module.exports = {
  runValidation
};

