/**
 * lib/config.js のテスト
 */

'use strict';

const { config, validate, display, getDataSourcesForUi } = require('../../lib/config');

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
      expect(['yahoo', 'csv', 'jquants']).toContain(config.data.mode);
      expect(['yahoo', 'alphavantage']).toContain(config.data.usOhlcvProvider);
      expect(['cc', 'oc']).toContain(config.backtest.jpWindowReturn);
      expect(config.operations).toBeDefined();
      expect(config.ops).toBeDefined();
      expect(config.preset).toBeDefined();
    });

    test('getDataSourcesForUi は保存設定＋米日の実行時経路を返す', () => {
      const ds = getDataSourcesForUi();
      expect(ds.lines).toHaveLength(3);
      expect(ds.lines[0]).toMatch(/【画面で保存している設定】/);
      expect(ds.lines[1]).toMatch(/米国セクター ETF・実行時の取得:/);
      expect(ds.lines[2]).toMatch(/日本セクター ETF・実行時の取得:/);
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
