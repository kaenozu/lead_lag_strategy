'use strict';

const request = require('supertest');
const { createApp } = require('../../src/server/bootstrap');

describe('system routes', () => {
  const app = createApp();

  test('GET /api/disclosure returns disclosure payload', async () => {
    await request(app)
      .get('/api/disclosure')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.lines)).toBe(true);
        expect(typeof res.body.short).toBe('string');
      });
  });

  test('GET /api/health returns ok status and timestamp', async () => {
    await request(app)
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.timestamp).toBe('string');
        expect(res.body.timestamp).toMatch(/T/);
      });
  });
});
