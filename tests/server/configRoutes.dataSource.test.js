/**
 * /api/config — データ取得は起動時自動。POST はバックテスト用パラメータのみ
 */

'use strict';

const fs = require('fs');
const request = require('supertest');
const { createApp } = require('../../src/server/bootstrap');
const { config, runtimeDataSourcePath } = require('../../lib/config');

describe('config routes: data source auto + POST params only', () => {
  const app = createApp();
  let backupFileContent;
  let prevMode;
  let prevUsp;
  let prevWl;

  beforeAll(() => {
    prevMode = config.data.mode;
    prevUsp = config.data.usOhlcvProvider;
    prevWl = config.backtest.windowLength;
    const p = runtimeDataSourcePath();
    backupFileContent = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  });

  afterEach(() => {
    config.data.mode = prevMode;
    config.data.usOhlcvProvider = prevUsp;
    config.backtest.windowLength = prevWl;
  });

  afterAll(() => {
    const p = runtimeDataSourcePath();
    if (backupFileContent !== null) {
      fs.writeFileSync(p, backupFileContent, 'utf8');
    } else {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  test('GET /api/config に dataMode・dataSources.autoManaged が含まれる', async () => {
    await request(app)
      .get('/api/config')
      .expect(200)
      .expect((res) => {
        expect(typeof res.body.dataMode).toBe('string');
        expect(typeof res.body.usOhlcvProvider).toBe('string');
        expect(res.body.dataSources && res.body.dataSources.autoManaged).toBe(true);
      });
  });

  test('POST は windowLength のみ更新し、無視された dataMode はサーバーの自動値のまま', async () => {
    const beforeMode = config.data.mode;
    await request(app)
      .post('/api/config')
      .set('Content-Type', 'application/json')
      .send({ windowLength: 70, dataMode: 'stooq' })
      .expect(200)
      .expect((res) => {
        expect(res.body.windowLength).toBe(70);
        expect(res.body.dataMode).toBe(beforeMode);
      });
    expect(config.backtest.windowLength).toBe(70);
  });
});
