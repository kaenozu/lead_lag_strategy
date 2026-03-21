/**
 * 設定管理
 * Configuration Management
 */

'use strict';

const path = require('path');

// 環境変数の読み込み（.envファイルがある場合）
try {
  require('dotenv').config();
} catch (e) {
  // dotenvがインストールされていない場合は無視
}

/**
 * 環境変数を数値に変換（デフォルト値付き）
 * @param {string} key - 環境変数キー
 * @param {number} defaultValue - デフォルト値
 * @returns {number} 数値
 */
function getNumber(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const num = parseFloat(value);
  if (isNaN(num)) {
    console.warn(`Invalid number for ${key}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return num;
}

/**
 * 環境変数を整数に変換（デフォルト値付き）
 * @param {string} key - 環境変数キー
 * @param {number} defaultValue - デフォルト値
 * @returns {number} 整数
 */
function getInt(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    console.warn(`Invalid integer for ${key}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return num;
}

/**
 * 環境変数を文字列として取得（デフォルト値付き）
 * @param {string} key - 環境変数キー
 * @param {string} defaultValue - デフォルト値
 * @returns {string} 文字列
 */
function getString(key, defaultValue) {
  return process.env[key] || defaultValue;
}

/**
 * 環境変数を真偽値に変換
 * @param {string} key - 環境変数キー
 * @param {boolean} defaultValue - デフォルト値
 * @returns {boolean} 真偽値
 */
function getBoolean(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

// ============================================
// 設定オブジェクト
// ============================================

const config = {
  // サーバー設定
  server: {
    port: getInt('PORT', 3000),
    env: getString('NODE_ENV', 'development'),
    isDevelopment: getString('NODE_ENV', 'development') === 'development',
    isProduction: getString('NODE_ENV', 'development') === 'production'
  },

  // バックテスト設定
  backtest: {
    windowLength: getInt('WINDOW_LENGTH', 60),
    nFactors: getInt('N_FACTORS', 3),
    lambdaReg: getNumber('LAMBDA_REG', 0.9),
    quantile: getNumber('QUANTILE', 0.3),
    warmupPeriod: getInt('WARMUP_PERIOD', 60)
  },

  // データ設定
  data: {
    startDate: getString('START_DATE', '2018-01-01'),
    endDate: getString('END_DATE', '2025-12-31'),
    dataDir: getString('DATA_DIR', './data'),
    outputDir: getString('OUTPUT_DIR', './results')
  },

  // 取引設定
  trading: {
    initialCapital: getInt('INITIAL_CAPITAL', 1000000),
    commissionRate: getNumber('COMMISSION_RATE', 0.0003),
    slippageRate: getNumber('SLIPPAGE_RATE', 0.0005),
    maxPositionSize: getNumber('MAX_POSITION_SIZE', 0.1),
    maxTotalExposure: getNumber('MAX_TOTAL_EXPOSURE', 0.6)
  },

  // ログ設定
  log: {
    level: getString('LOG_LEVEL', 'info'),
    file: getString('LOG_FILE', '') || null
  },

  // Yahoo Finance設定
  yahooFinance: {
    timeout: getInt('YF_TIMEOUT', 30000),
    retries: getInt('YF_RETRIES', 3)
  },

  // 銘柄設定
  tickers: {
    us: [
      'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 
      'XLRE', 'XLU', 'XLV', 'XLY'
    ],
    jp: [
      '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', 
      '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', 
      '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', 
      '1632.T', '1633.T'
    ]
  },

  // セクターラベル
  sectorLabels: {
    'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 
    'US_XLRE': 'cyclical', 'US_XLK': 'defensive', 'US_XLP': 'defensive', 
    'US_XLU': 'defensive', 'US_XLV': 'defensive', 'US_XLI': 'neutral', 
    'US_XLC': 'neutral', 'US_XLY': 'neutral',
    'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 
    'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 
    'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
    'JP_1619.T': 'neutral', 'JP_1620.T': 'neutral', 
    'JP_1622.T': 'neutral', 'JP_1623.T': 'neutral',
    'JP_1624.T': 'neutral', 'JP_1626.T': 'neutral', 
    'JP_1628.T': 'neutral', 'JP_1632.T': 'neutral',
    'JP_1633.T': 'neutral'
  }
};

/**
 * 設定値の検証
 * @returns {Array<string>} エラーメッセージの配列
 */
function validate() {
  const errors = [];

  // バックテスト設定の検証
  if (config.backtest.windowLength < 10) {
    errors.push('WINDOW_LENGTH must be at least 10');
  }
  if (config.backtest.lambdaReg < 0 || config.backtest.lambdaReg > 1) {
    errors.push('LAMBDA_REG must be between 0 and 1');
  }
  if (config.backtest.quantile <= 0 || config.backtest.quantile > 0.5) {
    errors.push('QUANTILE must be between 0 and 0.5');
  }

  // 取引設定の検証
  if (config.trading.initialCapital <= 0) {
    errors.push('INITIAL_CAPITAL must be positive');
  }
  if (config.trading.commissionRate < 0) {
    errors.push('COMMISSION_RATE must be non-negative');
  }

  return errors;
}

/**
 * 設定を表示（デバッグ用）
 * @returns {Object} 表示用設定オブジェクト（機密情報除外）
 */
function display() {
  return {
    server: { ...config.server },
    backtest: { ...config.backtest },
    data: { ...config.data },
    trading: {
      ...config.trading,
      initialCapital: '***' // 機密情報を隠す
    },
    log: { ...config.log }
  };
}

module.exports = {
  config,
  validate,
  display,
  getNumber,
  getInt,
  getString,
  getBoolean
};
