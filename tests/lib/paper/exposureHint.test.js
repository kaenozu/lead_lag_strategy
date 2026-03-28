'use strict';

const { paperExposureGuidance } = require('../../../lib/paper/exposureHint');

describe('lib/paper/exposureHint', () => {
  test('paperExposureGuidance は vol と DD の閾値を返す', () => {
    const g = paperExposureGuidance();
    expect(g.source).toContain('riskExposure');
    expect(g.volExposure.enabled).toBe(true);
    expect(g.volExposure.refAnnualVol).toBeGreaterThan(0);
    expect(g.equityDrawdownScaling.softDrawdown).toBeGreaterThan(0);
  });
});
