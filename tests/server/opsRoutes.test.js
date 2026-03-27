'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server/bootstrap');
const { config } = require('../../lib/config');
const { AUDIT_PATH } = require('../../lib/ops/audit');

describe('ops routes', () => {
  const app = createApp();
  let tmpDir;
  let prevOutputDir;
  let prevAuditContent;
  let prevPresetState;

  beforeAll(() => {
    prevOutputDir = config.data.outputDir;
    prevAuditContent = fs.existsSync(AUDIT_PATH) ? fs.readFileSync(AUDIT_PATH, 'utf8') : null;
    prevPresetState = {
      activePreset: config.operations.activePreset,
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile,
      maxPositionAbs: config.backtest.stability.maxPositionAbs,
      maxGrossExposure: config.backtest.stability.maxGrossExposure,
      dailyLossStop: config.backtest.stability.dailyLossStop
    };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-ops-routes-'));
    config.data.outputDir = tmpDir;
    fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'notifications.log'),
      [
        JSON.stringify({ level: 'info', message: 'first alert' }),
        JSON.stringify({ level: 'warn', message: 'second alert' })
      ].join('\n') + '\n',
      'utf8'
    );
    fs.writeFileSync(
      AUDIT_PATH,
      [
        JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', event: 'seed', payload: { id: 1 } }),
        JSON.stringify({ ts: '2026-01-01T00:00:01.000Z', event: 'seed', payload: { id: 2 } })
      ].join('\n') + '\n',
      'utf8'
    );
  });

  afterAll(() => {
    config.data.outputDir = prevOutputDir;
    config.operations.activePreset = prevPresetState.activePreset;
    config.backtest.windowLength = prevPresetState.windowLength;
    config.backtest.lambdaReg = prevPresetState.lambdaReg;
    config.backtest.quantile = prevPresetState.quantile;
    config.backtest.stability.maxPositionAbs = prevPresetState.maxPositionAbs;
    config.backtest.stability.maxGrossExposure = prevPresetState.maxGrossExposure;
    config.backtest.stability.dailyLossStop = prevPresetState.dailyLossStop;

    if (prevAuditContent !== null) {
      fs.writeFileSync(AUDIT_PATH, prevAuditContent, 'utf8');
    } else {
      try {
        fs.unlinkSync(AUDIT_PATH);
      } catch {
        /* ignore */
      }
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /api/presets returns the active preset list', async () => {
    await request(app)
      .get('/api/presets')
      .set('x-user-role', 'viewer')
      .expect(200)
      .expect((res) => {
        expect(res.body.active).toBe(config.operations.activePreset);
        expect(Array.isArray(res.body.presets)).toBe(true);
        expect(res.body.presets.length).toBeGreaterThan(0);
      });
  });

  test('POST /api/presets/apply updates the backtest config', async () => {
    const before = {
      activePreset: config.operations.activePreset,
      windowLength: config.backtest.windowLength,
      lambdaReg: config.backtest.lambdaReg,
      quantile: config.backtest.quantile
    };

    await request(app)
      .post('/api/presets/apply')
      .set('x-user-role', 'trader')
      .send({ name: 'balanced' })
      .expect(200)
      .expect((res) => {
        expect(res.body.ok).toBe(true);
        expect(res.body.active).toBe('balanced');
      });

    expect(config.operations.activePreset).toBe('balanced');
    expect(config.backtest.windowLength).toBe(Number(config.operations.profiles.balanced.windowLength));
    expect(config.backtest.lambdaReg).toBe(Number(config.operations.profiles.balanced.lambdaReg));
    expect(config.backtest.quantile).toBe(Number(config.operations.profiles.balanced.quantile));

    config.operations.activePreset = before.activePreset;
    config.backtest.windowLength = before.windowLength;
    config.backtest.lambdaReg = before.lambdaReg;
    config.backtest.quantile = before.quantile;
  });

  test('POST /api/execution/plan returns an order plan', async () => {
    await request(app)
      .post('/api/execution/plan')
      .set('x-user-role', 'trader')
      .send({
        cash: 100000,
        lotSize: 100,
        maxPerOrder: 80000,
        minOrderValue: 1000,
        signals: [
          { ticker: 'AAA', signal: 0.8, price: 50 },
          { ticker: 'BBB', signal: -0.2, price: 100 }
        ]
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.totalOrders).toBe(2);
        expect(res.body.items[0].ticker).toBe('AAA');
        expect(res.body.items[0].qty).toBe(1600);
        expect(res.body.items[0].side).toBe('BUY');
        expect(res.body.items[1].side).toBe('SELL');
      });
  });

  test('POST /api/allocation/inverse-vol normalizes weights', async () => {
    await request(app)
      .post('/api/allocation/inverse-vol')
      .set('x-user-role', 'admin')
      .send({
        metricsByStrategy: {
          alpha: { RISK: 2 },
          beta: { RISK: 4 }
        }
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.weights.alpha).toBeCloseTo(2 / 3, 5);
        expect(res.body.weights.beta).toBeCloseTo(1 / 3, 5);
      });
  });

  test('GET /api/alerts returns the notifications log', async () => {
    await request(app)
      .get('/api/alerts')
      .set('x-user-role', 'viewer')
      .expect(200)
      .expect((res) => {
        expect(res.body.alerts).toHaveLength(2);
        expect(res.body.alerts[1].message).toBe('second alert');
      });
  });

  test('GET /api/audit returns audit entries with limit', async () => {
    fs.writeFileSync(
      AUDIT_PATH,
      [
        JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', event: 'seed', payload: { id: 1 } }),
        JSON.stringify({ ts: '2026-01-01T00:00:01.000Z', event: 'seed', payload: { id: 2 } })
      ].join('\n') + '\n',
      'utf8'
    );

    await request(app)
      .get('/api/audit')
      .set('x-user-role', 'admin')
      .query({ limit: 1 })
      .expect(200)
      .expect((res) => {
        expect(res.body.entries).toHaveLength(1);
        expect(res.body.entries[0].payload.id).toBe(2);
      });
  });

  test('GET /api/ops/summary returns runtime state snapshot', async () => {
    await request(app)
      .get('/api/ops/summary')
      .set('x-user-role', 'viewer')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('latestSignalAt', null);
        expect(typeof res.body.anomalyCount).toBe('number');
        expect(res.body.quality).toBeNull();
      });
  });

  test('GET /api/anomalies returns an empty list by default', async () => {
    await request(app)
      .get('/api/anomalies')
      .set('x-user-role', 'viewer')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items).toHaveLength(0);
      });
  });
});
