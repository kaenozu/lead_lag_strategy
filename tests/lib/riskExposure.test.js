'use strict';

const {
  annualizedVolFromPrices,
  volatilityExposureScale,
  equityDrawdownScale,
  DEFAULT_VOL_EXPOSURE,
  DEFAULT_EQUITY_DD_SCALING
} = require('../../lib/riskExposure');

describe('lib/riskExposure', () => {
  test('annualizedVolFromPrices は平坦系列で 0 に近い', () => {
    const flat = Array.from({ length: 30 }, () => 100);
    const v = annualizedVolFromPrices(flat, 20);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0.05);
  });

  test('annualizedVolFromPrices は振れた系列で正の値', () => {
    const prices = [100];
    for (let i = 1; i <= 25; i++) {
      prices.push(prices[i - 1] * (1 + (i % 3 === 0 ? -0.02 : 0.015)));
    }
    const v = annualizedVolFromPrices(prices, 20);
    expect(v).toBeGreaterThan(0.05);
  });

  test('volatilityExposureScale は disabled で 1', () => {
    const r = volatilityExposureScale(0.5, { ...DEFAULT_VOL_EXPOSURE, enabled: false });
    expect(r.scale).toBe(1);
  });

  test('volatilityExposureScale は低ボラで maxScale', () => {
    const cfg = { ...DEFAULT_VOL_EXPOSURE, enabled: true, refAnnualVol: 0.2, maxScale: 1, minScale: 0.3, capAnnualVol: 0.4 };
    const r = volatilityExposureScale(0.05, cfg);
    expect(r.scale).toBe(1);
  });

  test('volatilityExposureScale は高ボラで minScale に近づく', () => {
    const cfg = {
      ...DEFAULT_VOL_EXPOSURE,
      enabled: true,
      refAnnualVol: 0.1,
      capAnnualVol: 0.2,
      minScale: 0.25,
      maxScale: 1.0
    };
    const low = volatilityExposureScale(0.1, cfg);
    const high = volatilityExposureScale(0.2, cfg);
    expect(high.scale).toBeLessThan(low.scale);
    expect(high.scale).toBe(0.25);
  });

  test('equityDrawdownScale は浅い DD で 1', () => {
    const s = equityDrawdownScale(-0.01, { ...DEFAULT_EQUITY_DD_SCALING, enabled: true, softDrawdown: 0.08 });
    expect(s).toBe(1);
  });

  test('equityDrawdownScale は深い DD で floor', () => {
    const cfg = {
      ...DEFAULT_EQUITY_DD_SCALING,
      enabled: true,
      softDrawdown: 0.05,
      hardDrawdown: 0.15,
      scaleAtSoft: 1,
      scaleAtHard: 0.4
    };
    expect(equityDrawdownScale(-0.2, cfg)).toBe(0.4);
  });

  test('equityDrawdownScale は中間で線形補間', () => {
    const cfg = {
      ...DEFAULT_EQUITY_DD_SCALING,
      enabled: true,
      softDrawdown: 0.1,
      hardDrawdown: 0.2,
      scaleAtSoft: 1,
      scaleAtHard: 0.5
    };
    const mid = equityDrawdownScale(-0.15, cfg);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.75, 5);
  });
});
