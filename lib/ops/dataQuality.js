'use strict';

function safeStd(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function qualityForTickerRows(ticker, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ticker, ok: false, reason: 'EMPTY_SERIES', missingRatio: 1, outlierCount: 0, rows: 0 };
  }
  let missing = 0;
  const rets = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = Number(r && r.close);
    if (!Number.isFinite(c) || c <= 0) {
      missing++;
      continue;
    }
    if (i > 0) {
      const p = Number(rows[i - 1] && rows[i - 1].close);
      if (Number.isFinite(p) && p > 0) rets.push((c - p) / p);
    }
  }
  const sigma = safeStd(rets);
  const outlierCount = rets.filter((x) => sigma > 0 && Math.abs(x) > 6 * sigma).length;
  const missingRatio = (missing / rows.length);
  const ok = missingRatio <= 0.1 && outlierCount <= Math.max(2, Math.floor(rets.length * 0.05));
  return { ticker, ok, reason: ok ? null : 'QUALITY_THRESHOLD', missingRatio, outlierCount, rows: rows.length };
}

function assessDataQuality(byTicker) {
  const details = [];
  for (const [ticker, rows] of Object.entries(byTicker || {})) {
    details.push(qualityForTickerRows(ticker, rows));
  }
  const bad = details.filter((d) => !d.ok);
  return {
    ok: bad.length === 0,
    badTickers: bad.map((b) => b.ticker),
    details
  };
}

module.exports = {
  assessDataQuality
};
