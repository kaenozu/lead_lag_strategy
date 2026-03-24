'use strict';

function explainSignals(signals, topN = 5) {
  const rows = Array.isArray(signals) ? signals.slice() : [];
  const sorted = rows.slice().sort((a, b) => Number(b.signal || 0) - Number(a.signal || 0));
  const top = sorted.slice(0, Math.max(1, topN));
  const bottom = sorted.slice(-Math.max(1, topN)).reverse();

  function toReason(s) {
    const val = Number(s.signal || 0);
    const dir = val >= 0 ? 'bullish' : 'bearish';
    const mag = Math.abs(val);
    const strength = mag > 0.03 ? 'strong' : mag > 0.015 ? 'medium' : 'weak';
    return {
      ticker: s.ticker,
      name: s.name,
      signal: val,
      direction: dir,
      strength,
      rationale: `${dir} ${strength} signal based on US lead-lag factor exposure`
    };
  }

  return {
    topLongRationale: top.map(toReason),
    topShortRationale: bottom.map(toReason)
  };
}

module.exports = {
  explainSignals
};
