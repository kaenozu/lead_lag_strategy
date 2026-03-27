'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server/bootstrap');
const { config } = require('../../lib/config');

describe('paper routes', () => {
  const app = createApp();
  let tmpDir;
  let prevOutputDir;

  beforeAll(() => {
    prevOutputDir = config.data.outputDir;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadlag-paper-routes-'));
    config.data.outputDir = tmpDir;
  });

  afterAll(() => {
    config.data.outputDir = prevOutputDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /api/paper/verification falls back when file is missing', async () => {
    await request(app)
      .get('/api/paper/verification')
      .expect(200)
      .expect((res) => {
        expect(res.body.skipped).toBe(true);
        expect(res.body.reason).toMatch(/paper verification first/i);
      });
  });

  test('GET /api/walkforward/summary falls back when file is missing', async () => {
    await request(app)
      .get('/api/walkforward/summary')
      .expect(200)
      .expect((res) => {
        expect(res.body.ok).toBe(false);
        expect(res.body.message).toMatch(/paper:walkforward first/i);
      });
  });

  test('GET /api/paper/order-csv returns CSV attachment from signal.json', async () => {
    fs.writeFileSync(path.join(tmpDir, 'signal.json'), JSON.stringify({
      buyCandidates: [
        { ticker: 'AAA', signal: 0.5, price: 100 }
      ]
    }), 'utf8');

    await request(app)
      .get('/api/paper/order-csv')
      .set('x-user-role', 'viewer')
      .query({ cash: '100000' })
      .expect(200)
      .expect('Content-Type', /text\/csv; charset=utf-8/)
      .expect('Content-Disposition', 'attachment; filename="order_plan.csv"')
      .expect((res) => {
        expect(res.text).toContain('Side,Ticker,Qty,EstValue,RefPrice');
        expect(res.text).toContain('BUY,AAA,500,50000,100');
      });
  });

  test('GET /api/paper/order-csv supports inline text output', async () => {
    fs.writeFileSync(path.join(tmpDir, 'signal.json'), JSON.stringify({
      buyCandidates: [
        { ticker: 'BBB', signal: 0.5, price: 100 }
      ]
    }), 'utf8');

    await request(app)
      .get('/api/paper/order-csv')
      .set('x-user-role', 'viewer')
      .query({ cash: '100000', inline: '1' })
      .expect(200)
      .expect('Content-Type', /text\/plain; charset=utf-8/)
      .expect((res) => {
        expect(res.text).toContain('BUY,BBB,500,50000,100');
      });
  });

  test('GET /api/operating-rules returns merged fallback rules', async () => {
    await request(app)
      .get('/api/operating-rules')
      .set('x-user-role', 'viewer')
      .expect(200)
      .expect((res) => {
        expect(res.body.path).toContain('operating-rules.json');
        expect(Array.isArray(res.body.rules.customLines)).toBe(true);
      });
  });
});
