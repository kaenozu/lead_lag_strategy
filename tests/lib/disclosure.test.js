'use strict';

const { riskPayload, RISK_DISCLOSURE_SHORT } = require('../../lib/disclosure');

describe('lib/disclosure', () => {
  test('riskPayload は short と lines を返す', () => {
    const p = riskPayload();
    expect(p.short).toBe(RISK_DISCLOSURE_SHORT);
    expect(Array.isArray(p.lines)).toBe(true);
    expect(p.lines.length).toBeGreaterThan(0);
    expect(p.lines.every((x) => typeof x === 'string')).toBe(true);
  });
});
