/**
 * 設定管理
 * Configuration Management with Centralized Constants
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('./constants');

/** データ取得モードは環境変数ではなく Web 画面＋ config/runtime-data-source.json（gitignore） */
const DEFAULT_DATA_MODE = 'jquants';
const DEFAULT_US_OHLCV_PROVIDER = 'alphavantage';

/** リポジトリルート（cwd に依存しない。埋め込み起動・別 cwd でも .env と runtime JSON と一致させる） */
const PROJECT_ROOT = path.join(__dirname, '..');

// 環境変数: プロジェクト直下の .env → .env.local（後者が優先）
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local'), override: true });
} catch (e) {
  // dotenv がインストールされていない場合は無視（このときは process.env のみ）
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
  /** Web UI・ヘルプの「上位 40%」説明と一致（未設定時の単一の正） */
  QUANTILE: 0.4,
  WARMUP_PERIOD: 60,
  CHART_CALENDAR_DAYS: 2000,
  ROLLING_WINDOW: 252,
  ANNUALIZATION_FACTOR: 252
};

/**
 * 取引コストのデフォルト
 */
/** 論文 Table 2 は取引コストなし。実務想定でかける場合は環境変数で上書き */
const TRANSACTION_COSTS = {
  SLIPPAGE: 0,
  COMMISSION: 0
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
 * 複数キーのうち最初の非空値（trim 済み）。公式名以外の別名にも対応
 * @param {...string} keys
 * @returns {string}
 */
function firstEnvTrimmed(...keys) {
  for (const key of keys) {
    const v = process.env[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return '';
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

function getJsonObject(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`Invalid JSON for ${key}, using default object`);
    return defaultValue;
  }
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
    isProduction: getString('NODE_ENV', 'development') === 'production',
    // 0/false/empty なら未設定扱い。例: TRUST_PROXY=1
    trustProxy: (() => {
      const raw = getString('TRUST_PROXY', '').trim().toLowerCase();
      if (!raw || raw === '0' || raw === 'false' || raw === 'off') return false;
      const asNum = Number(raw);
      return Number.isInteger(asNum) && asNum >= 0 ? asNum : true;
    })()
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
    startDate: getString('START_DATE', '2010-01-01'),
    endDate: getString('END_DATE', '2025-12-31'),
    dataDir: getString('DATA_DIR', './data'),
    outputDir: getString('OUTPUT_DIR', './results'),
    /** yahoo | csv | jquants（Web / runtime-data-source.json で変更。API キーは .env） */
    mode: DEFAULT_DATA_MODE,
    /** 米国 ETF: yahoo | alphavantage */
    usOhlcvProvider: DEFAULT_US_OHLCV_PROVIDER,
    alphaVantageApiKey: firstEnvTrimmed(
      'ALPHA_VANTAGE_API_KEY',
      'ALPHAVANTAGE_API_KEY',
      'AV_API_KEY',
      'ALPHA_VANTAGE_KEY'
    ),
    alphaVantageDailyMaxCalls: getInt('ALPHA_VANTAGE_DAILY_MAX_CALLS', 25),
    /** compact=直近約100営業日（無料）。full は有料枠のみ（ALPHA_VANTAGE_OUTPUTSIZE=full） */
    alphaVantageOutputSize: (() => {
      const v = String(firstEnvTrimmed('ALPHA_VANTAGE_OUTPUTSIZE') || 'compact').toLowerCase();
      return v === 'full' ? 'full' : 'compact';
    })(),
    alphaVantageCacheDir: getString('ALPHA_VANTAGE_CACHE_DIR', ''),
    jquantsRecentWeeksYahoo: getInt('JQUANTS_YAHOO_RECENT_WEEKS', 12),
    jquantsMail: firstEnvTrimmed('JQUANTS_API_MAIL'),
    jquantsPassword: firstEnvTrimmed('JQUANTS_API_PASSWORD'),
    jquantsRefreshToken: firstEnvTrimmed('JQUANTS_REFRESH_TOKEN', 'J_QUANTS_REFRESH_TOKEN'),
    /** ダッシュボードのリフレッシュトークンと同一。JQUANTS_REFRESH_TOKEN より後から指定したい場合用 */
    jquantsApiKey: firstEnvTrimmed('JQUANTS_API_KEY', 'J_QUANTS_API_KEY'),
    jquantsApiBase: getString('JQUANTS_API_BASE', 'https://api.jquants.com/v1'),
    /** 例: {"1617.T":"16170"} を JSON 文字列で JQUANTS_SYMBOL_MAP_JSON に渡す */
    jquantsCodes: getJsonObject('JQUANTS_SYMBOL_MAP_JSON', {})
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

function runtimeDataSourcePath() {
  return path.join(PROJECT_ROOT, 'config', 'runtime-data-source.json');
}

function loadRuntimeDataSourceFromFile() {
  const p = runtimeDataSourcePath();
  try {
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw && typeof raw.mode === 'string') {
      const m = String(raw.mode).toLowerCase();
      if (m === 'yahoo' || m === 'csv' || m === 'jquants') {
        config.data.mode = m;
      }
    }
    if (raw && typeof raw.usOhlcvProvider === 'string') {
      const u = String(raw.usOhlcvProvider).toLowerCase();
      if (u === 'yahoo' || u === 'alphavantage') {
        config.data.usOhlcvProvider = u;
      }
    }
  } catch (e) {
    console.warn('[config] runtime-data-source.json を読めません:', e.message);
  }
}

function persistRuntimeDataSourceToFile() {
  const p = runtimeDataSourcePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    mode: config.data.mode,
    usOhlcvProvider: config.data.usOhlcvProvider
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    // Windows 等で既存ファイルへの rename が失敗することがある → 上書きコピーにフォールバック
    try {
      fs.copyFileSync(tmp, p);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch (e2) {
        /* ignore */
      }
    }
  }
}

/**
 * @param {{ mode?: string, usOhlcvProvider?: string }} body
 * @returns {{ errors: string[], patch: { mode?: string, usOhlcvProvider?: string } | null }}
 */
function computeDataSourceUpdate(body) {
  const errors = [];
  const hasMode =
    body &&
    body.mode !== undefined &&
    body.mode !== null &&
    String(body.mode).trim() !== '';
  const hasUsp =
    body &&
    body.usOhlcvProvider !== undefined &&
    body.usOhlcvProvider !== null &&
    String(body.usOhlcvProvider).trim() !== '';

  if (!hasMode && !hasUsp) {
    return { errors, patch: null };
  }

  let nextMode = config.data.mode;
  let nextUsp = config.data.usOhlcvProvider;

  if (hasMode) {
    const mode = String(body.mode).toLowerCase();
    if (!['yahoo', 'csv', 'jquants'].includes(mode)) {
      errors.push('dataMode must be yahoo, csv, or jquants');
    } else {
      nextMode = mode;
    }
  }
  if (hasUsp) {
    const usp = String(body.usOhlcvProvider).toLowerCase();
    if (!['yahoo', 'alphavantage'].includes(usp)) {
      errors.push('usOhlcvProvider must be yahoo or alphavantage');
    } else {
      nextUsp = usp;
    }
  }

  if (errors.length) {
    return { errors, patch: null };
  }
  /** @type {{ mode?: string, usOhlcvProvider?: string }} */
  const patch = {};
  if (hasMode) patch.mode = nextMode;
  if (hasUsp) patch.usOhlcvProvider = nextUsp;
  return { errors, patch };
}

/**
 * API 用・変更意図がある項目の検証のみ（設定は書き換えない）
 * @param {{ mode?: string, usOhlcvProvider?: string }} body
 * @returns {string[]}
 */
function getDataSourceUpdateErrors(body) {
  return computeDataSourceUpdate(body).errors;
}

/**
 * Web UI からデータ取得モードを更新しディスクに保存
 * @param {{ mode?: string, usOhlcvProvider?: string }} body
 * @returns {{ ok: boolean, errors?: string[] }}
 */
function applyDataSourceSettings(body) {
  const { errors, patch } = computeDataSourceUpdate(body);
  if (errors.length) {
    return { ok: false, errors };
  }
  if (!patch) {
    return { ok: true };
  }
  if (patch.mode !== undefined) config.data.mode = patch.mode;
  if (patch.usOhlcvProvider !== undefined) {
    config.data.usOhlcvProvider = patch.usOhlcvProvider;
  }
  persistRuntimeDataSourceToFile();
  return { ok: true };
}

loadRuntimeDataSourceFromFile();

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
  if (dm !== 'yahoo' && dm !== 'csv' && dm !== 'jquants') {
    errors.push('data.mode must be yahoo, csv, or jquants');
  }

  const usp = config.data.usOhlcvProvider;
  if (usp !== 'yahoo' && usp !== 'alphavantage') {
    errors.push('data.usOhlcvProvider must be yahoo or alphavantage');
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

function hasJquantsCredentials(data) {
  if (String(data.jquantsRefreshToken || '').trim()) return true;
  if (String(data.jquantsApiKey || '').trim()) return true;
  if (String(data.jquantsMail || '').trim() && String(data.jquantsPassword || '').trim()) {
    return true;
  }
  return false;
}

function hasAlphaVantageKey(data) {
  return Boolean(String(data.alphaVantageApiKey || '').trim());
}

/**
 * Web UI 用・データ取得（機密は含めない）
 */
function getDataSourcesForUi() {
  const d = config.data;
  const csv = d.mode === 'csv';

  const usEffective = (() => {
    if (csv) {
      return `ローカル CSV（${d.dataDir}）`;
    }
    if (d.usOhlcvProvider === 'alphavantage' && hasAlphaVantageKey(d)) {
      return 'Alpha Vantage（ディスクキャッシュ・日次 API 回数上限あり）';
    }
    if (d.usOhlcvProvider === 'alphavantage' && !hasAlphaVantageKey(d)) {
      return 'Yahoo Finance（フォールバック：Alpha Vantage 用キーが process に見つかりません）';
    }
    return 'Yahoo Finance（画面で米国=yahoo を選択中）';
  })();

  const jpEffective = (() => {
    if (csv) {
      return `ローカル CSV（${d.dataDir}）`;
    }
    if (d.mode === 'yahoo') {
      return 'Yahoo Finance（画面で日本=yahoo を選択中）';
    }
    if (d.mode === 'jquants') {
      if (hasJquantsCredentials(d)) {
        return `J-Quants（履歴）+ Yahoo（直近 ${d.jquantsRecentWeeksYahoo} 週）`;
      }
      return 'Yahoo Finance（フォールバック：J-Quants 認証が process に見つかりません）';
    }
    return 'Yahoo Finance';
  })();

  const selection = `【画面で保存している設定】日本モード=${d.mode} · 米国=${d.usOhlcvProvider}`;
  const selectionSummary = `日本=${d.mode} · 米国=${d.usOhlcvProvider}`;

  return {
    backtestDataMode: d.mode,
    usOhlcvProvider: d.usOhlcvProvider,
    /** 値は出さず、サーバーが env から読めたかだけ（チャット共有とは無関係） */
    credentialDetection: {
      alphaVantage: hasAlphaVantageKey(d),
      jquants: hasJquantsCredentials(d)
    },
    /** Web の dt/dd 用（aria-live 付き領域だけ更新する） */
    selectionSummary,
    effectiveUs: usEffective,
    effectiveJp: jpEffective,
    lines: [
      selection,
      `米国セクター ETF・実行時の取得: ${usEffective}`,
      `日本セクター ETF・実行時の取得: ${jpEffective}`
    ]
  };
}

/**
 * 設定を表示（デバッグ用・機密情報除外）
 * @returns {Object} 表示用設定オブジェクト
 */
function display() {
  return {
    server: { ...config.server },
    backtest: { ...config.backtest },
    data: {
      ...config.data,
      jquantsPassword: config.data.jquantsPassword ? '***' : '',
      jquantsRefreshToken: config.data.jquantsRefreshToken ? '***' : '',
      jquantsApiKey: config.data.jquantsApiKey ? '***' : '',
      alphaVantageApiKey: config.data.alphaVantageApiKey ? '***' : ''
    },
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
  getDataSourcesForUi,
  applyDataSourceSettings,
  getDataSourceUpdateErrors,
  runtimeDataSourcePath,
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
