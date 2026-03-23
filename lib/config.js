/**
 * 設定管理
 * Configuration Management with Centralized Constants
 */

'use strict';

const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('./constants');

// 環境変数の読み込み（.env ファイルがある場合）
try {
  require('dotenv').config();
} catch (_e) {
  // dotenv がインストールされていない場合は無視
}

// ============================================
// 定数（マジックナンバーの集約）
// ============================================

/**
 * 数値計算のデフォルトパラメータ
 */
const NUMERIC_DEFAULTS = {
  EIGEN_TOLERANCE: 1e-6,
  EIGEN_MAX_ITER: 1000,
  ZERO_THRESHOLD: 1e-10,
  CORRELATION_MIN_SAMPLES: 2
};

/**
 * バックテストのデフォルトパラメータ
 */
const BACKTEST_DEFAULTS = {
  WINDOW_LENGTH: 60,
  N_FACTORS: 3,
  LAMBDA_REG: 0.9,
  QUANTILE: 0.3,
  WARMUP_PERIOD: 60,
  CHART_CALENDAR_DAYS: 2000,
  ROLLING_WINDOW: 252,
  ANNUALIZATION_FACTOR: 252
};

/**
 * 取引コストのデフォルト
 */
const TRANSACTION_COSTS = {
  SLIPPAGE: 0.001,    // 0.1%
  COMMISSION: 0.0005  // 0.05%
};

/**
 * リスク管理パラメータ
 */
const RISK_LIMITS = {
  INITIAL_CAPITAL: 1000000,
  COMMISSION_RATE: 0.0003,
  SLIPPAGE_RATE: 0.0005,
  MAX_POSITION_SIZE: 0.1,
  MAX_TOTAL_EXPOSURE: 0.6
};

/**
 * API レート制限
 */
const RATE_LIMITS = {
  API_WINDOW_MS: 60 * 1000,      // 1 分
  API_MAX_REQUESTS: 30,
  BACKTEST_WINDOW_MS: 5 * 60 * 1000,  // 5 分
  BACKTEST_MAX_REQUESTS: 10
};

/**
 * データ取得設定
 */
const DATA_FETCH = {
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  BASE_DELAY: 1000
};

/**
 * 検証ルール
 */
const VALIDATION_RULES = {
  WINDOW_LENGTH: { min: 10, max: 500 },
  LAMBDA_REG: { min: 0, max: 1 },
  QUANTILE: { min: 0, max: 0.5 },
  N_FACTORS: { min: 1, max: 10 }
};

// ============================================
// 環境変数ヘルパー
// ============================================

/**
 * 環境変数を数値に変換（デフォルト値付き）
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
 */
function getString(key, defaultValue) {
  return process.env[key] || defaultValue;
}

/**
 * 環境変数を真偽値に変換
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
    windowLength: getInt('WINDOW_LENGTH', BACKTEST_DEFAULTS.WINDOW_LENGTH),
    nFactors: getInt('N_FACTORS', BACKTEST_DEFAULTS.N_FACTORS),
    lambdaReg: getNumber('LAMBDA_REG', BACKTEST_DEFAULTS.LAMBDA_REG),
    quantile: getNumber('QUANTILE', BACKTEST_DEFAULTS.QUANTILE),
    warmupPeriod: getInt('WARMUP_PERIOD', BACKTEST_DEFAULTS.WARMUP_PERIOD),
    chartCalendarDays: getInt('BACKTEST_CHART_DAYS', BACKTEST_DEFAULTS.CHART_CALENDAR_DAYS),
    transactionCosts: {
      slippage: getNumber('BACKTEST_SLIPPAGE', TRANSACTION_COSTS.SLIPPAGE),
      commission: getNumber('BACKTEST_COMMISSION', TRANSACTION_COSTS.COMMISSION)
    },
    rollingReportWindow: getInt('BACKTEST_ROLLING_WINDOW', BACKTEST_DEFAULTS.ROLLING_WINDOW),
    annualizationFactor: getInt('ANNUALIZATION_FACTOR', BACKTEST_DEFAULTS.ANNUALIZATION_FACTOR),
    /** 推定ウィンドウ内の日本側リターン: cc または oc（抄録は予測対象が OC。窓は論文本文に合わせて切替） */
    jpWindowReturn: getString('BACKTEST_JP_WINDOW_RETURN', 'cc').toLowerCase()
  },

  // データ設定
  data: {
    startDate: getString('START_DATE', '2018-01-01'),
    endDate: getString('END_DATE', '2025-12-31'),
    dataDir: getString('DATA_DIR', './data'),
    outputDir: getString('OUTPUT_DIR', './results'),
    /** yahoo: 近似。csv: dataDir の CSV を優先（論文再現用） */
    mode: getString('BACKTEST_DATA_MODE', 'yahoo').toLowerCase()
  },

  // 取引設定
  trading: {
    initialCapital: getInt('INITIAL_CAPITAL', RISK_LIMITS.INITIAL_CAPITAL),
    commissionRate: getNumber('COMMISSION_RATE', RISK_LIMITS.COMMISSION_RATE),
    slippageRate: getNumber('SLIPPAGE_RATE', RISK_LIMITS.SLIPPAGE_RATE),
    maxPositionSize: getNumber('MAX_POSITION_SIZE', RISK_LIMITS.MAX_POSITION_SIZE),
    maxTotalExposure: getNumber('MAX_TOTAL_EXPOSURE', RISK_LIMITS.MAX_TOTAL_EXPOSURE)
  },

  // ログ設定
  log: {
    level: getString('LOG_LEVEL', 'info'),
    file: getString('LOG_FILE', '') || null
  },

  // Yahoo Finance 設定
  yahooFinance: {
    timeout: getInt('YF_TIMEOUT', DATA_FETCH.TIMEOUT),
    retries: getInt('YF_RETRIES', DATA_FETCH.MAX_RETRIES)
  },

  // 数値計算設定
  numeric: {
    eigenTolerance: getNumber('EIGEN_TOLERANCE', NUMERIC_DEFAULTS.EIGEN_TOLERANCE),
    eigenMaxIter: getInt('EIGEN_MAX_ITER', NUMERIC_DEFAULTS.EIGEN_MAX_ITER),
    zeroThreshold: getNumber('ZERO_THRESHOLD', NUMERIC_DEFAULTS.ZERO_THRESHOLD)
  },

  // レート制限設定
  rateLimits: {
    api: {
      windowMs: getInt('API_RATE_WINDOW', RATE_LIMITS.API_WINDOW_MS),
      max: getInt('API_RATE_MAX', RATE_LIMITS.API_MAX_REQUESTS)
    },
    backtest: {
      windowMs: getInt('BACKTEST_RATE_WINDOW', RATE_LIMITS.BACKTEST_WINDOW_MS),
      max: getInt('BACKTEST_RATE_MAX', RATE_LIMITS.BACKTEST_MAX_REQUESTS)
    }
  },

  // 検証ルール
  validation: VALIDATION_RULES,

  tickers: {
    us: US_ETF_TICKERS,
    jp: JP_ETF_TICKERS
  },

  sectorLabels: SECTOR_LABELS
};

/**
 * 結合リターン行列の列順と一致するセクターラベルキー（事前部分空間 v3 用）
 * @param {string[]} usTickers - 米国ティッカー（例 XLB）
 * @param {string[]} jpTickers - 日本ティッカー（例 1617.T）
 * @param {Object} sectorLabels - US_XLB / JP_1617.T 形式
 * @returns {string[]}
 */
function buildOrderedSectorKeys(usTickers, jpTickers, sectorLabels) {
  const keys = [];
  for (const t of usTickers) {
    const k = `US_${t}`;
    if (sectorLabels[k] === undefined) {
      throw new Error(`buildOrderedSectorKeys: missing label for ${k}`);
    }
    keys.push(k);
  }
  for (const t of jpTickers) {
    const k = `JP_${t}`;
    if (sectorLabels[k] === undefined) {
      throw new Error(`buildOrderedSectorKeys: missing label for ${k}`);
    }
    keys.push(k);
  }
  return keys;
}

config.pca = {
  orderedSectorKeys: buildOrderedSectorKeys(
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    SECTOR_LABELS
  )
};

// ============================================
// 検証関数
// ============================================

/**
 * 設定値の検証
 * @returns {Array<string>} エラーメッセージの配列
 */
function validate() {
  const errors = [];
  const rules = config.validation;

  // バックテスト設定の検証
  if (config.backtest.windowLength < rules.WINDOW_LENGTH.min ||
      config.backtest.windowLength > rules.WINDOW_LENGTH.max) {
    errors.push(`WINDOW_LENGTH must be between ${rules.WINDOW_LENGTH.min} and ${rules.WINDOW_LENGTH.max}`);
  }

  if (config.backtest.lambdaReg < rules.LAMBDA_REG.min ||
      config.backtest.lambdaReg > rules.LAMBDA_REG.max) {
    errors.push(`LAMBDA_REG must be between ${rules.LAMBDA_REG.min} and ${rules.LAMBDA_REG.max}`);
  }

  if (config.backtest.quantile <= rules.QUANTILE.min ||
      config.backtest.quantile >= rules.QUANTILE.max) {
    errors.push(`QUANTILE must be between ${rules.QUANTILE.min} and ${rules.QUANTILE.max}`);
  }

  if (config.backtest.nFactors < rules.N_FACTORS.min ||
      config.backtest.nFactors > rules.N_FACTORS.max) {
    errors.push(`N_FACTORS must be between ${rules.N_FACTORS.min} and ${rules.N_FACTORS.max}`);
  }

  const jwr = config.backtest.jpWindowReturn;
  if (jwr !== 'cc' && jwr !== 'oc') {
    errors.push('BACKTEST_JP_WINDOW_RETURN must be cc or oc');
  }

  const dm = config.data.mode;
  if (dm !== 'yahoo' && dm !== 'csv') {
    errors.push('BACKTEST_DATA_MODE must be yahoo or csv');
  }

  // 取引設定の検証
  if (config.trading.initialCapital <= 0) {
    errors.push('INITIAL_CAPITAL must be positive');
  }
  if (config.trading.commissionRate < 0) {
    errors.push('COMMISSION_RATE must be non-negative');
  }

  // 数値計算設定の検証
  if (config.numeric.eigenTolerance <= 0) {
    errors.push('EIGEN_TOLERANCE must be positive');
  }
  if (config.numeric.eigenMaxIter <= 0) {
    errors.push('EIGEN_MAX_ITER must be positive');
  }

  return errors;
}

/**
 * 設定を表示（デバッグ用・機密情報除外）
 * @returns {Object} 表示用設定オブジェクト
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
    log: { ...config.log },
    numeric: { ...config.numeric },
    rateLimits: { ...config.rateLimits }
  };
}

/**
 * 設定を更新
 * @param {string} key - 設定キー（ドット区切り）
 * @param {*} value - 新しい値
 * @returns {boolean} 成功した場合 true
 */
function set(key, value) {
  const keys = key.split('.');
  let obj = config;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) {
      return false;
    }
    obj = obj[keys[i]];
  }

  obj[keys[keys.length - 1]] = value;
  return true;
}

/**
 * 設定を取得
 * @param {string} key - 設定キー（ドット区切り）
 * @param {*} defaultValue - デフォルト値
 * @returns {*} 設定値
 */
function get(key, defaultValue = undefined) {
  const keys = key.split('.');
  let obj = config;

  for (let i = 0; i < keys.length; i++) {
    if (!obj[keys[i]]) {
      return defaultValue;
    }
    obj = obj[keys[i]];
  }

  return obj;
}

module.exports = {
  config,
  validate,
  display,
  set,
  get,
  getNumber,
  getInt,
  getString,
  getBoolean,
  buildOrderedSectorKeys,
  NUMERIC_DEFAULTS,
  BACKTEST_DEFAULTS,
  TRANSACTION_COSTS,
  RISK_LIMITS,
  RATE_LIMITS,
  DATA_FETCH,
  VALIDATION_RULES,
  US_ETF_TICKERS,
  JP_ETF_TICKERS,
  SECTOR_LABELS
};
