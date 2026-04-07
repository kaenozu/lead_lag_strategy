'use strict';

function normalizeWeights(weightsByName) {
  const entries = Object.entries(weightsByName || {}).filter(([, w]) => Number.isFinite(w) && w > 0);
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0) return {};
  return Object.fromEntries(entries.map(([k, w]) => [k, w / sum]));
}

function inverseVolAllocation(metricsByStrategy) {
  const raw = {};
  for (const [name, m] of Object.entries(metricsByStrategy || {})) {
    const risk = Number(m?.RISK);
    if (Number.isFinite(risk) && risk > 0) {
      raw[name] = 1 / risk;
    }
  }
  return normalizeWeights(raw);
}

module.exports = {
  normalizeWeights,
  inverseVolAllocation
};
