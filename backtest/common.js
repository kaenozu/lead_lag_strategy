'use strict';

const fs = require('fs');
const path = require('path');
const { correlationMatrixSample } = require('../lib/math');
const { buildPaperAlignedReturnRows } = require('../lib/data');

function computeCCReturns(ohlcData) {
  const returns = [];
  let prevClose = null;
  for (const row of ohlcData) {
    if (prevClose !== null && prevClose > 0) {
      returns.push({
        date: row.date,
        return: (row.close - prevClose) / prevClose
      });
    }
    prevClose = row.close;
  }
  return returns;
}

function computeOCReturns(ohlcData) {
  return ohlcData
    .filter((r) => r.open > 0)
    .map((r) => ({
      date: r.date,
      return: (r.close - r.open) / r.open
    }));
}

function buildReturnMatricesFromOhlcv(usData, jpData, jpWindowReturn) {
  const usTickers = Object.keys(usData);
  const jpTickers = Object.keys(jpData);

  const usCCReturns = {};
  const jpCCReturns = {};
  const jpOCReturns = {};

  for (const t of usTickers) usCCReturns[t] = computeCCReturns(usData[t]);
  for (const t of jpTickers) {
    jpCCReturns[t] = computeCCReturns(jpData[t]);
    jpOCReturns[t] = computeOCReturns(jpData[t]);
  }

  const usCCMap = new Map();
  const jpCCMap = new Map();
  const jpOCMap = new Map();

  for (const t in usCCReturns) {
    for (const r of usCCReturns[t]) {
      if (!usCCMap.has(r.date)) usCCMap.set(r.date, {});
      usCCMap.get(r.date)[t] = r.return;
    }
  }
  for (const t in jpCCReturns) {
    for (const r of jpCCReturns[t]) {
      if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
      jpCCMap.get(r.date)[t] = r.return;
    }
    for (const r of jpOCReturns[t]) {
      if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
      jpOCMap.get(r.date)[t] = r.return;
    }
  }

  return buildPaperAlignedReturnRows(
    usCCMap,
    jpCCMap,
    jpOCMap,
    usTickers,
    jpTickers,
    jpWindowReturn
  );
}

function computeCFull(returnsUs, returnsJp) {
  const combined = returnsUs
    .slice(0, Math.min(returnsUs.length, returnsJp.length))
    .map((r, i) => [...r.values, ...returnsJp[i].values]);
  return correlationMatrixSample(combined);
}

function capPositionWeights(weights, maxAbsWeight) {
  if (!Number.isFinite(maxAbsWeight) || maxAbsWeight <= 0) return weights;
  let out = weights.map((w) => Math.max(-maxAbsWeight, Math.min(maxAbsWeight, w)));
  const longSum = out.filter((w) => w > 0).reduce((a, b) => a + b, 0);
  const shortAbsSum = out.filter((w) => w < 0).reduce((a, b) => a + Math.abs(b), 0);
  if (longSum > 0) out = out.map((w) => (w > 0 ? w / longSum : w));
  if (shortAbsSum > 0) out = out.map((w) => (w < 0 ? w / shortAbsSum : w));
  return out;
}

function smoothWeights(prevWeights, currWeights, alpha) {
  if (!prevWeights || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    return currWeights;
  }
  const n = Math.min(prevWeights.length, currWeights.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = alpha * prevWeights[i] + (1 - alpha) * currWeights[i];
  return out;
}

function turnover(prevWeights, currWeights) {
  if (!prevWeights || !currWeights) return 1;
  const n = Math.min(prevWeights.length, currWeights.length);
  let t = 0;
  for (let i = 0; i < n; i++) t += Math.abs(currWeights[i] - prevWeights[i]);
  return t / 2;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeOhlcvCsvByTicker(targetDir, byTicker) {
  ensureDir(targetDir);
  for (const t in byTicker) {
    const csv = 'Date,Open,High,Low,Close,Volume\n' +
      byTicker[t].map((r) => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
    fs.writeFileSync(path.join(targetDir, `${t}.csv`), csv);
  }
}

function printStrategySummary(summary) {
  console.log('\n' + '='.repeat(70));
  console.log('Strategy Comparison Summary');
  console.log('='.repeat(70));
  console.log(
    'Strategy'.padEnd(15) +
    'AR (%)'.padStart(10) +
    'RISK (%)'.padStart(10) +
    'R/R'.padStart(8) +
    'MDD (%)'.padStart(10) +
    'Total (%)'.padStart(12)
  );
  console.log('-'.repeat(70));
  for (const { name, m } of summary) {
    console.log(
      name.padEnd(15) +
      (m.AR * 100).toFixed(2).padStart(10) +
      (m.RISK * 100).toFixed(2).padStart(10) +
      m.RR.toFixed(2).padStart(8) +
      (m.MDD * 100).toFixed(2).padStart(10) +
      ((m.Cumulative - 1) * 100).toFixed(2).padStart(12)
    );
  }
}

function writeStrategyOutputs(outputDir, summary, strategySeries) {
  ensureDir(outputDir);

  const summaryCSV = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Total (%)\n' +
    summary.map((s) =>
      `${s.name},${(s.m.AR * 100).toFixed(4)},${(s.m.RISK * 100).toFixed(4)},${s.m.RR.toFixed(4)},${(s.m.MDD * 100).toFixed(4)},${((s.m.Cumulative - 1) * 100).toFixed(4)}`
    ).join('\n');
  fs.writeFileSync(path.join(outputDir, 'backtest_summary_real.csv'), summaryCSV);

  for (const strat of strategySeries) {
    let cum = 1;
    const cumData = strat.returns.map((r) => {
      cum *= (1 + r.return);
      return { date: r.date, cumulative: cum };
    });
    const csv = 'Date,Cumulative\n' +
      cumData.map((r) => `${r.date},${r.cumulative.toFixed(6)}`).join('\n');
    fs.writeFileSync(
      path.join(outputDir, `cumulative_${strat.name.toLowerCase().replace(' ', '_')}.csv`),
      csv
    );
  }
}

module.exports = {
  buildReturnMatricesFromOhlcv,
  computeCFull,
  capPositionWeights,
  smoothWeights,
  turnover,
  ensureDir,
  writeOhlcvCsvByTicker,
  printStrategySummary,
  writeStrategyOutputs
};
