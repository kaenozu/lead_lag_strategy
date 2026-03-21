/**
 * lib/config.js のテスト
 */

'use strict';

const { config, validate, display } = require('../../lib/config');

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
