'use strict';

const { assessDataQuality } = require('../../lib/ops/dataQuality');
const { inverseVolAllocation } = require('../../lib/ops/allocation');
const { explainSignals } = require('../../lib/ops/explain');
const { buildExecutionPlan } = require('../../lib/ops/executionPlanner');

describe('lib/ops', () => {
  test('assessDataQuality flags empty series', () => {
    const q = assessDataQuality({ AAA: [], BBB: [{ close: 10 }, { close: 11 }] });
    expect(q.ok).toBe(false);
    expect(q.badTickers).toContain('AAA');
  });

  test('inverseVolAllocation normalizes weights', () => {
    const out = inverseVolAllocation({ a: { RISK: 0.1 }, b: { RISK: 0.2 } });
    const sum = Object.values(out).reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(out.a).toBeGreaterThan(out.b);
  });

  test('inverseVolAllocation returns empty when no valid risk', () => {
    const out = inverseVolAllocation({ a: { RISK: 0 }, b: {} });
    expect(out).toEqual({});
  });

  test('explainSignals returns top rationale entries', () => {
    const out = explainSignals(
      [
        { ticker: 'AAA', name: 'A', signal: 0.1 },
        { ticker: 'BBB', name: 'B', signal: -0.3 }
      ],
      1
    );
    expect(out.topLongRationale).toHaveLength(1);
    expect(out.topShortRationale).toHaveLength(1);
  });

  test('buildExecutionPlan creates orders from signal array', () => {
    const plan = buildExecutionPlan(
      [
        { ticker: 'AAA', signal: 0.4, price: 1000 },
        { ticker: 'BBB', signal: 0.2, price: 2000 }
      ],
      {
        cash: 100000,
        maxPerOrder: 30000
      }
    );
    expect(plan.items.length).toBe(2);
    expect(plan.items[0].qty).toBeGreaterThanOrEqual(0);
    expect(plan.totalValue).toBeGreaterThan(0);
  });
});
