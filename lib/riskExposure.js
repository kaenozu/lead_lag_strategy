/**
 * 曝露スケーリング（高ボラ・エクイティDD）
 * バックテスト / ペーパーで共有するルックアヘッドなしの縮小係数
 */

'use strict';

const DEFAULT_VOL_EXPOSURE = {
  enabled: false,
  lookback: 20,
  refAnnualVol: 0.12,
  capAnnualVol: 0.30,
  minScale: 0.4,
  maxScale: 1.0
};

const DEFAULT_EQUITY_DD_SCALING = {
  enabled: false,
  softDrawdown: 0.08,
  hardDrawdown: 0.18,
  scaleAtSoft: 1.0,
  scaleAtHard: 0.35
};

/**
 * 価格系列から年率換算ボラ（直近 lookback 日の日次リターン標本偏差 × √252）
 * @param {number[]} prices
 * @param {number} lookback
 * @returns {number}
 */
function annualizedVolFromPrices(prices, lookback) {
  if (!Array.isArray(prices) || prices.length < 2) return 0;
  const rets = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = prices[i - 1];
    const p1 = prices[i];
    if (p0 > 0 && p1 > 0) rets.push(p1 / p0 - 1);
  }
  if (rets.length === 0) return 0;
  const n = Math.max(1, Math.min(lookback, rets.length));
  const slice = rets.slice(-n);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const denom = slice.length > 1 ? slice.length - 1 : 1;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / denom;
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(252);
}

/**
 * 高ボラ環境でのポジション縮小（ref 以下はフル、cap 以上は floor、間は線形）
 * @param {number} annualVol
 * @param {typeof DEFAULT_VOL_EXPOSURE} cfg
 * @returns {{ scale: number, annualVol: number }}
 */
function volatilityExposureScale(annualVol, cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : DEFAULT_VOL_EXPOSURE;
  if (!c.enabled) {
    return { scale: 1, annualVol };
  }
  const ref = Math.max(1e-6, c.refAnnualVol);
  const cap = Math.max(ref + 1e-6, c.capAnnualVol);
  const lo = Math.min(c.minScale, c.maxScale);
  const hi = Math.max(c.minScale, c.maxScale);
  if (!Number.isFinite(annualVol) || annualVol <= 0) {
    return { scale: hi, annualVol: 0 };
  }
  if (annualVol <= ref) return { scale: hi, annualVol };
  if (annualVol >= cap) return { scale: lo, annualVol };
  const t = (annualVol - ref) / (cap - ref);
  const scale = hi + t * (lo - hi);
  return { scale, annualVol };
}

/**
 * エクイティドローダウンに応じた縮小（soft までは 1、hard 以下は floor、間は線形）
 * drawdown は負値（例: -0.1 = -10%）
 * @param {number} drawdown
 * @param {typeof DEFAULT_EQUITY_DD_SCALING} cfg
 * @returns {number}
 */
function equityDrawdownScale(drawdown, cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : DEFAULT_EQUITY_DD_SCALING;
  if (!c.enabled) return 1;
  const soft = Math.min(c.softDrawdown, c.hardDrawdown);
  const hard = Math.max(c.softDrawdown, c.hardDrawdown);
  const d = drawdown;
  if (!Number.isFinite(d) || d >= -soft) return c.scaleAtSoft;
  if (d <= -hard) return c.scaleAtHard;
  const t = (-soft - d) / (hard - soft);
  return c.scaleAtSoft + t * (c.scaleAtHard - c.scaleAtSoft);
}

module.exports = {
  DEFAULT_VOL_EXPOSURE,
  DEFAULT_EQUITY_DD_SCALING,
  annualizedVolFromPrices,
  volatilityExposureScale,
  equityDrawdownScale
};
