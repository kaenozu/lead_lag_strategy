/**
 * セキュリティ課題修正エージェント
 * 
 * 役割：
 * 1. API 認証の実装
 * 2. 入力検証の強化
 * 3. 機密情報の環境変数化
 * 
 * 使用方法：
 * node agents/fix_security.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');

const logger = createLogger('FixSecurityAgent');

// ============================================
// 修正タスク定義
// ============================================

const tasks = [
  {
    id: 'SEC-001',
    title: 'API 認証の実装',
    priority: 'high',
    files: ['server.js', '.env.example'],
    description: '全 API エンドポイントに API キー認証を追加'
  },
  {
    id: 'SEC-002',
    title: '入力検証の強化',
    priority: 'high',
    files: ['server.js'],
    description: 'API パラメータの型チェックとサニタイズを強化'
  },
  {
    id: 'SEC-003',
    title: '.env.example の更新',
    priority: 'high',
    files: ['.env.example'],
    description: 'API_KEY などのセキュリティ設定を追加'
  }
];

// ============================================
// 修正関数
// ============================================

/**
 * Task SEC-001: API 認証の実装
 */
function implementApiKeyAuth() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  let content = fs.readFileSync(serverPath, 'utf8');

  // API_KEY のインポート追加（dotenv の後）
  const dotenvMatch = content.match(/require\('dotenv'\)\.config\(\);/);
  if (dotenvMatch && !content.includes('const API_KEY = process.env.API_KEY')) {
    const importSection = `require('dotenv').config();
const API_KEY = process.env.API_KEY;`;
    content = content.replace(/require\('dotenv'\)\.config\(\);/, importSection);
    logger.info('API_KEY 定数を追加しました');
  }

  // API キー認証ミドルウェアの追加
  const authMiddleware = `
// ============================================
// 認証ミドルウェア
// ============================================

/**
 * API キー認証ミドルウェア
 */
function apiKeyAuth(req, res, next) {
  // 開発環境では認証をスキップ（オプション）
  if (process.env.NODE_ENV === 'development' && !process.env.API_KEY) {
    return next();
  }

  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    logger.warn('Unauthorized API access attempt', {
      path: req.path,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Valid API key required in x-api-key header'
    });
  }
  next();
}`;

  // セキュリティ設定セクションの後に追加
  const securitySection = content.match(/(\/\/ ============================================\n\/\/ セキュリティ設定\n\/\/ ============================================)/);
  if (securitySection && !content.includes('function apiKeyAuth')) {
    content = content.replace(securitySection[0], securitySection[0] + authMiddleware);
    logger.info('apiKeyAuth ミドルウェアを追加しました');
  }

  // API エンドポイントへの認証適用
  // app.use('/api/backtest', backtestLimiter); を置換
  if (content.includes("app.use('/api/backtest', backtestLimiter)") && 
      !content.includes("apiKeyAuth, backtestLimiter")) {
    content = content.replace(
      "app.use('/api/backtest', backtestLimiter)",
      "app.use('/api/backtest', apiKeyAuth, backtestLimiter)"
    );
    logger.info('/api/backtest に認証を適用しました');
  }

  if (content.includes("app.use('/api/signal', apiLimiter)") && 
      !content.includes("apiKeyAuth, apiLimiter")) {
    content = content.replace(
      "app.use('/api/signal', apiLimiter)",
      "app.use('/api/signal', apiKeyAuth, apiLimiter)"
    );
    logger.info('/api/signal に認証を適用しました');
  }

  fs.writeFileSync(serverPath, content, 'utf8');
  logger.info('server.js の更新を完了しました');
}

/**
 * Task SEC-002: 入力検証の強化
 */
function enhanceInputValidation() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  let content = fs.readFileSync(serverPath, 'utf8');

  // validateBacktestParams 関数を置換
  const oldValidation = `function validateBacktestParams(body) {
  const errors = [];
  const params = {};

  // windowLength
  if (body.windowLength !== undefined) {
    const val = parseInt(body.windowLength, 10);
    if (isNaN(val) || val < 10 || val > 500) {
      errors.push('windowLength must be between 10 and 500');
    } else {
      params.windowLength = val;
    }
  }

  // lambdaReg
  if (body.lambdaReg !== undefined) {
    const val = parseFloat(body.lambdaReg);
    if (isNaN(val) || val < 0 || val > 1) {
      errors.push('lambdaReg must be between 0 and 1');
    } else {
      params.lambdaReg = val;
    }
  }

  // quantile
  if (body.quantile !== undefined) {
    const val = parseFloat(body.quantile);
    if (isNaN(val) || val <= 0 || val > 0.5) {
      errors.push('quantile must be between 0 and 0.5');
    } else {
      params.quantile = val;
    }
  }

  // nFactors
  if (body.nFactors !== undefined) {
    const val = parseInt(body.nFactors, 10);
    if (isNaN(val) || val < 1 || val > 10) {
      errors.push('nFactors must be between 1 and 10');
    } else {
      params.nFactors = val;
    }
  }

  return { errors, params };
}`;

  const newValidation = `/**
 * リクエストパラメータを検証・サニタイズ
 * セキュリティ強化のため型チェックとサニタイズを実施
 */
function validateBacktestParams(body) {
  const errors = [];
  const params = {};

  // windowLength: 整数値（10-500）
  if (body.windowLength !== undefined) {
    if (typeof body.windowLength !== 'string' && typeof body.windowLength !== 'number') {
      errors.push('windowLength must be a number');
    } else {
      const val = parseInt(String(body.windowLength).trim(), 10);
      if (isNaN(val) || val < 10 || val > 500) {
        errors.push('windowLength must be between 10 and 500');
      } else {
        params.windowLength = val;
      }
    }
  }

  // lambdaReg: 浮動小数点数（0-1）
  if (body.lambdaReg !== undefined) {
    if (typeof body.lambdaReg !== 'string' && typeof body.lambdaReg !== 'number') {
      errors.push('lambdaReg must be a number');
    } else {
      const val = parseFloat(String(body.lambdaReg).trim());
      if (isNaN(val) || val < 0 || val > 1) {
        errors.push('lambdaReg must be between 0 and 1');
      } else {
        params.lambdaReg = val;
      }
    }
  }

  // quantile: 浮動小数点数（0-0.5）
  if (body.quantile !== undefined) {
    if (typeof body.quantile !== 'string' && typeof body.quantile !== 'number') {
      errors.push('quantile must be a number');
    } else {
      const val = parseFloat(String(body.quantile).trim());
      if (isNaN(val) || val <= 0 || val > 0.5) {
        errors.push('quantile must be between 0 and 0.5');
      } else {
        params.quantile = val;
      }
    }
  }

  // nFactors: 整数値（1-10）
  if (body.nFactors !== undefined) {
    if (typeof body.nFactors !== 'string' && typeof body.nFactors !== 'number') {
      errors.push('nFactors must be a number');
    } else {
      const val = parseInt(String(body.nFactors).trim(), 10);
      if (isNaN(val) || val < 1 || val > 10) {
        errors.push('nFactors must be between 1 and 10');
      } else {
        params.nFactors = val;
      }
    }
  }

  return { errors, params };
}`;

  if (content.includes(oldValidation)) {
    content = content.replace(oldValidation, newValidation);
    logger.info('validateBacktestParams 関数を強化しました');
  } else {
    logger.warn('validateBacktestParams 関数のパターンが見つかりませんでした');
  }

  fs.writeFileSync(serverPath, content, 'utf8');
  logger.info('server.js の入力検証を更新しました');
}

/**
 * Task SEC-003: .env.example の更新
 */
function updateEnvExample() {
  const envPath = path.join(__dirname, '..', '.env.example');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  // API_KEY の追加
  if (!content.includes('API_KEY')) {
    const securitySection = `
# ============================================
# Security
# ============================================

# API Key for authentication (required for production)
# Generate a secure random key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY=your-secure-api-key-here

`;
    
    // ファイルの先頭に追加
    content = securitySection + content;
    logger.info('.env.example に API_KEY セクションを追加しました');
  }

  // NODE_ENV の追加
  if (!content.includes('NODE_ENV')) {
    content = content.replace(
      'LOG_LEVEL=info',
      'NODE_ENV=development\nLOG_LEVEL=info'
    );
    logger.info('NODE_ENV を追加しました');
  }

  fs.writeFileSync(envPath, content, 'utf8');
  logger.info('.env.example を更新しました');
}

// ============================================
// メイン処理
// ============================================

async function main() {
  logger.info('セキュリティ課題修正エージェントを開始します');
  logger.info(`対象ディレクトリ：${__dirname}/..`);

  try {
    // 各タスクを実行
    logger.info('Task SEC-001: API 認証の実装');
    implementApiKeyAuth();

    logger.info('Task SEC-002: 入力検証の強化');
    enhanceInputValidation();

    logger.info('Task SEC-003: .env.example の更新');
    updateEnvExample();

    logger.info('すべてのセキュリティ修正を完了しました');
    logger.info('次に実施すること:');
    logger.info('  1. .env ファイルに API_KEY を設定');
    logger.info('  2. server.js の動作を確認');
    logger.info('  3. API エンドポイントに x-api-key ヘッダーを追加してテスト');

  } catch (error) {
    logger.error('修正中にエラーが発生しました', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// エージェント実行
if (require.main === module) {
  main();
}

module.exports = {
  tasks,
  implementApiKeyAuth,
  enhanceInputValidation,
  updateEnvExample
};
