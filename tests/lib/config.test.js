/**
 * lib/config.js のテスト
 */

'use strict';

const { config, validate, display, set, get, getNumber, getInt, getBoolean, buildOrderedSectorKeys } = require('../../lib/config');

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
      expect(['yahoo', 'csv']).toContain(config.data.mode);
      expect(['cc', 'oc']).toContain(config.backtest.jpWindowReturn);
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

    test('validate: windowLength が範囲外でエラーを返す', () => {
      const savedWindowLength = config.backtest.windowLength;
      config.backtest.windowLength = 5; // min=10 より小さい
      const errors = validate();
      expect(errors.some(e => e.includes('WINDOW_LENGTH'))).toBe(true);
      config.backtest.windowLength = savedWindowLength;
    });

    test('validate: lambdaReg が範囲外でエラーを返す', () => {
      const saved = config.backtest.lambdaReg;
      config.backtest.lambdaReg = 1.5; // max=1 より大きい
      const errors = validate();
      expect(errors.some(e => e.includes('LAMBDA_REG'))).toBe(true);
      config.backtest.lambdaReg = saved;
    });

    test('validate: quantile が 0 でエラーを返す', () => {
      const saved = config.backtest.quantile;
      config.backtest.quantile = 0; // min は 0 より大きい
      const errors = validate();
      expect(errors.some(e => e.includes('QUANTILE'))).toBe(true);
      config.backtest.quantile = saved;
    });

    test('validate: nFactors が範囲外でエラーを返す', () => {
      const saved = config.backtest.nFactors;
      config.backtest.nFactors = 0; // min=1 より小さい
      const errors = validate();
      expect(errors.some(e => e.includes('N_FACTORS'))).toBe(true);
      config.backtest.nFactors = saved;
    });

    test('validate: jpWindowReturn が cc/oc 以外でエラーを返す', () => {
      const saved = config.backtest.jpWindowReturn;
      config.backtest.jpWindowReturn = 'bad';
      const errors = validate();
      expect(errors.some(e => e.includes('BACKTEST_JP_WINDOW_RETURN'))).toBe(true);
      config.backtest.jpWindowReturn = saved;
    });

    test('validate: data.mode が yahoo/csv 以外でエラーを返す', () => {
      const saved = config.data.mode;
      config.data.mode = 'unknown';
      const errors = validate();
      expect(errors.some(e => e.includes('BACKTEST_DATA_MODE'))).toBe(true);
      config.data.mode = saved;
    });

    test('validate: initialCapital が 0 以下でエラーを返す', () => {
      const saved = config.trading.initialCapital;
      config.trading.initialCapital = -100;
      const errors = validate();
      expect(errors.some(e => e.includes('INITIAL_CAPITAL'))).toBe(true);
      config.trading.initialCapital = saved;
    });

    test('validate: commissionRate が負でエラーを返す', () => {
      const saved = config.trading.commissionRate;
      config.trading.commissionRate = -0.001;
      const errors = validate();
      expect(errors.some(e => e.includes('COMMISSION_RATE'))).toBe(true);
      config.trading.commissionRate = saved;
    });

    test('validate: eigenTolerance が 0 以下でエラーを返す', () => {
      const saved = config.numeric.eigenTolerance;
      config.numeric.eigenTolerance = 0;
      const errors = validate();
      expect(errors.some(e => e.includes('EIGEN_TOLERANCE'))).toBe(true);
      config.numeric.eigenTolerance = saved;
    });

    test('validate: eigenMaxIter が 0 以下でエラーを返す', () => {
      const saved = config.numeric.eigenMaxIter;
      config.numeric.eigenMaxIter = 0;
      const errors = validate();
      expect(errors.some(e => e.includes('EIGEN_MAX_ITER'))).toBe(true);
      config.numeric.eigenMaxIter = saved;
    });
  });

  describe('set / get', () => {
    test('set でネストされた設定値を更新できる', () => {
      const result = set('server.port', 9999);
      expect(result).toBe(true);
      expect(config.server.port).toBe(9999);
      // 元に戻す
      set('server.port', 3000);
    });

    test('存在しないキーは false を返す', () => {
      const result = set('nonexistent.key', 'value');
      expect(result).toBe(false);
    });

    test('get でネストされた設定値を取得できる', () => {
      const port = get('server.port');
      expect(typeof port).toBe('number');
    });

    test('存在しないキーはデフォルト値を返す', () => {
      const val = get('nonexistent.key', 'default');
      expect(val).toBe('default');
    });

    test('get でデフォルト値省略時は undefined', () => {
      const val = get('nonexistent.deep.key');
      expect(val).toBeUndefined();
    });
  });

  describe('getNumber / getInt / getBoolean', () => {
    test('getNumber: 未設定時はデフォルト値', () => {
      delete process.env._TEST_NUM;
      const val = getNumber('_TEST_NUM', 42);
      expect(val).toBe(42);
    });

    test('getNumber: 有効な数値文字列は数値を返す', () => {
      process.env._TEST_NUM = '3.14';
      const val = getNumber('_TEST_NUM', 0);
      expect(val).toBeCloseTo(3.14);
      delete process.env._TEST_NUM;
    });

    test('getNumber: 空文字列はデフォルト値', () => {
      process.env._TEST_NUM = '';
      const val = getNumber('_TEST_NUM', 99);
      expect(val).toBe(99);
      delete process.env._TEST_NUM;
    });

    test('getNumber: 無効な文字列はデフォルト値にフォールバック', () => {
      process.env._TEST_NUM = 'notanumber';
      const val = getNumber('_TEST_NUM', 99);
      expect(val).toBe(99);
      delete process.env._TEST_NUM;
    });

    test('getInt: 未設定時はデフォルト値', () => {
      delete process.env._TEST_INT;
      const val = getInt('_TEST_INT', 7);
      expect(val).toBe(7);
    });

    test('getInt: 有効な整数文字列は整数を返す', () => {
      process.env._TEST_INT = '123';
      const val = getInt('_TEST_INT', 0);
      expect(val).toBe(123);
      delete process.env._TEST_INT;
    });

    test('getInt: 空文字列はデフォルト値', () => {
      process.env._TEST_INT = '';
      const val = getInt('_TEST_INT', 5);
      expect(val).toBe(5);
      delete process.env._TEST_INT;
    });

    test('getInt: 無効な文字列はデフォルト値にフォールバック', () => {
      process.env._TEST_INT = 'bad';
      const val = getInt('_TEST_INT', 5);
      expect(val).toBe(5);
      delete process.env._TEST_INT;
    });

    test('getBoolean: true 文字列は true', () => {
      process.env._TEST_BOOL = 'true';
      const val = getBoolean('_TEST_BOOL', false);
      expect(val).toBe(true);
      delete process.env._TEST_BOOL;
    });

    test('getBoolean: "1" は true', () => {
      process.env._TEST_BOOL = '1';
      const val = getBoolean('_TEST_BOOL', false);
      expect(val).toBe(true);
      delete process.env._TEST_BOOL;
    });

    test('getBoolean: 未設定時はデフォルト値', () => {
      delete process.env._TEST_BOOL;
      expect(getBoolean('_TEST_BOOL', false)).toBe(false);
      expect(getBoolean('_TEST_BOOL', true)).toBe(true);
    });

    test('getBoolean: false 文字列は false', () => {
      process.env._TEST_BOOL = 'false';
      const val = getBoolean('_TEST_BOOL', true);
      expect(val).toBe(false);
      delete process.env._TEST_BOOL;
    });

    test('getBoolean: 空文字列はデフォルト値', () => {
      process.env._TEST_BOOL = '';
      const val = getBoolean('_TEST_BOOL', true);
      expect(val).toBe(true);
      delete process.env._TEST_BOOL;
    });
  });

  describe('buildOrderedSectorKeys', () => {
    test('正常なラベルでキーを生成', () => {
      const labels = {
        'US_XLK': 'cyclical',
        'JP_1306': 'cyclical',
      };
      const keys = buildOrderedSectorKeys(['XLK'], ['1306'], labels);
      expect(keys).toEqual(['US_XLK', 'JP_1306']);
    });

    test('US 銘柄のラベルが欠けているとエラー', () => {
      const labels = { 'JP_1306': 'cyclical' };
      expect(() => buildOrderedSectorKeys(['XLK'], ['1306'], labels))
        .toThrow('missing label for US_XLK');
    });

    test('JP 銘柄のラベルが欠けているとエラー', () => {
      const labels = { 'US_XLK': 'cyclical' };
      expect(() => buildOrderedSectorKeys(['XLK'], ['1306'], labels))
        .toThrow('missing label for JP_1306');
    });
  });
});
