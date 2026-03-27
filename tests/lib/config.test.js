/**
 * lib/config.js のテスト
 */

'use strict';

const fs = require('fs');
const {
  config,
  validate,
  display,
  getDataSourcesForUi,
  applyDataSourceSettings,
  runtimeDataSourcePath
} = require('../../lib/config');

describe('lib/config', () => {
  describe('config', () => {
    test('設定オブジェクトが存在', () => {
      expect(config).toBeDefined();
      expect(config.server).toBeDefined();
      expect(config.backtest).toBeDefined();
      expect(config.trading).toBeDefined();
    });

    test('サーバー設定', () => {
      expect(config.server.port).toBeDefined();
      expect(typeof config.server.port).toBe('number');
      expect(config.server.env).toBeDefined();
    });

    test('バックテスト設定', () => {
      expect(config.backtest.windowLength).toBeDefined();
      expect(config.backtest.lambdaReg).toBeDefined();
      expect(config.backtest.quantile).toBeDefined();
      expect(config.backtest.chartCalendarDays).toBeGreaterThan(0);
      expect(config.backtest.transactionCosts.slippage).toBeDefined();
      expect(config.backtest.transactionCosts.commission).toBeDefined();
      expect(config.backtest.rollingReportWindow).toBeGreaterThan(0);
      expect(config.backtest.execution).toBeDefined();
      expect(config.backtest.stability).toBeDefined();
      expect(config.backtest.walkforward).toBeDefined();
    });

    test('取引設定', () => {
      expect(config.trading.initialCapital).toBeDefined();
      expect(config.trading.commissionRate).toBeDefined();
    });

    test('銘柄設定', () => {
      expect(config.tickers.us).toBeInstanceOf(Array);
      expect(config.tickers.jp).toBeInstanceOf(Array);
      expect(config.tickers.us.length).toBeGreaterThan(0);
      expect(config.tickers.jp.length).toBeGreaterThan(0);
    });

    test('セクターラベル設定', () => {
      expect(config.sectorLabels).toBeInstanceOf(Object);
      expect(Object.keys(config.sectorLabels).length).toBeGreaterThan(0);
    });

    test('PCA 列順キー', () => {
      expect(config.pca.orderedSectorKeys).toBeInstanceOf(Array);
      expect(config.pca.orderedSectorKeys.length).toBe(
        config.tickers.us.length + config.tickers.jp.length
      );
    });

    test('データモード・窓リターン型', () => {
      expect(['yahoo', 'csv', 'jquants', 'stooq']).toContain(config.data.mode);
      expect(['yahoo', 'alphavantage', 'stooq']).toContain(config.data.usOhlcvProvider);
      expect(['cc', 'oc']).toContain(config.backtest.jpWindowReturn);
      expect(config.operations).toBeDefined();
      expect(config.operations.profiles).toBeDefined();
      expect(Object.keys(config.operations.profiles).length).toBeGreaterThan(0);
      expect(['log', 'webhook']).toContain(config.operations.notificationChannel);
      expect(config.ops).toBeDefined();
      expect(config.preset).toBeDefined();
      expect(config.preset.profiles).toBe(config.operations.profiles);
    });

    test('applyDataSourceSettings は dataMode のみでも日本モードを更新できる', () => {
      const p = runtimeDataSourcePath();
      const backup = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      const prevMode = config.data.mode;
      const prevUsp = config.data.usOhlcvProvider;
      try {
        applyDataSourceSettings({ dataMode: 'stooq' });
        expect(config.data.mode).toBe('stooq');
      } finally {
        config.data.mode = prevMode;
        config.data.usOhlcvProvider = prevUsp;
        if (backup !== null) {
          fs.writeFileSync(p, backup, 'utf8');
        } else {
          try {
            fs.unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    });

    test('getDataSourcesForUi は自動選択＋米日の実行時経路を返す', () => {
      const ds = getDataSourcesForUi();
      expect(ds.autoManaged).toBe(true);
      expect(ds.lines).toHaveLength(5);
      expect(ds.lines[0]).toMatch(/【自動選択】/);
      expect(ds.lines[1]).toMatch(/選定理由（日本）/);
      expect(ds.lines[2]).toMatch(/選定理由（米国）/);
      expect(ds.lines[3]).toMatch(/米国セクター ETF・実行時の取得:/);
      expect(ds.lines[4]).toMatch(/日本セクター ETF・実行時の取得:/);
      expect(ds.recommendation).toMatchObject({
        dataMode: expect.any(String),
        usOhlcvProvider: expect.any(String),
        reasonJp: expect.any(String),
        reasonUs: expect.any(String),
        summary: expect.any(String),
        matchesSelection: true
      });
      expect(ds.selectionSummary).toBe(`日本=${config.data.mode} · 米国=${config.data.usOhlcvProvider}`);
      expect(typeof ds.effectiveUs).toBe('string');
      expect(typeof ds.effectiveJp).toBe('string');
      expect(ds.credentialDetection).toEqual({
        alphaVantage: expect.any(Boolean),
        jquants: expect.any(Boolean)
      });
      expect(ds.backtestDataMode).toBe(config.data.mode);
      expect(ds.usOhlcvProvider).toBe(config.data.usOhlcvProvider);
    });
  });

  describe('validate', () => {
    test('デフォルト設定でエラーなし', () => {
      const errors = validate();
      expect(errors).toEqual([]);
    });

    test('設定オブジェクトを返す', () => {
      const displayConfig = display();
      expect(displayConfig.server).toBeDefined();
    });

    test('初期資金が隠蔽される', () => {
      const displayConfig = display();
      expect(displayConfig.trading.initialCapital).toBe('***');
    });
  });
});
