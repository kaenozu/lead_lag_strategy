'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildExecutionPlan(signals, options = {}) {
  const cash = Number(options.cash || 0);
  const lot = Math.max(1, Number(options.lotSize || 1));
  const maxPerOrder = Number(options.maxPerOrder || Infinity);
  const minOrderValue = Number(options.minOrderValue || 0);
  const items = [];

  for (const s of signals || []) {
    const signal = Number(s.signal || 0);
    const price = Number(s.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const side = signal >= 0 ? 'BUY' : 'SELL';
    const confidence = clamp(Math.abs(signal), 0, 1);
    const budget = Math.min(cash * confidence, maxPerOrder);
    const qtyRaw = Math.floor(budget / price);
    const qty = Math.floor(qtyRaw / lot) * lot;
    const value = qty * price;
    if (qty <= 0 || value < minOrderValue) continue;
    items.push({
      ticker: s.ticker,
      side,
      price,
      qty,
      value,
      confidence
    });
  }

  const totalValue = items.reduce((a, b) => a + b.value, 0);
  return {
    generatedAt: new Date().toISOString(),
    totalOrders: items.length,
    totalValue,
    items
  };
}

module.exports = {
  buildExecutionPlan
};
