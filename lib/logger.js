/**
 * 構造化ロガー
 * Structured Logger using Winston
 */

'use strict';

const winston = require('winston');
const path = require('path');

// 環境変数からログレベルを取得
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE = process.env.LOG_FILE;

// カスタムフォーマット
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// コンソール用フォーマット
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// トランスポートの設定
const transports = [
  new winston.transports.Console({
    format: consoleFormat,
    level: LOG_LEVEL
  })
];

// ファイル出力が設定されている場合
if (LOG_FILE) {
  transports.push(
    new winston.transports.File({
      filename: LOG_FILE,
      format: customFormat,
      level: LOG_LEVEL,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

// ロガーの作成
const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'lead-lag-strategy' },
  transports,
  exitOnError: false
});

/**
 * コンテキスト付きロガーを作成
 * @param {string} context - コンテキスト名（例: 'PCA', 'Backtest'）
 * @returns {Object} コンテキスト付きロガー
 */
function createLogger(context) {
  return {
    debug: (message, meta = {}) => logger.debug(message, { context, ...meta }),
    info: (message, meta = {}) => logger.info(message, { context, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { context, ...meta }),
    error: (message, meta = {}) => logger.error(message, { context, ...meta }),
    
    /**
     * パフォーマンス計測用
     * @param {string} operation - 操作名
     * @param {Function} fn - 実行する関数
     * @returns {Promise<*>} 関数の戻り値
     */
    async profile(operation, fn) {
      const start = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - start;
        this.info(`${operation} completed`, { duration: `${duration}ms` });
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.error(`${operation} failed`, { duration: `${duration}ms`, error: error.message });
        throw error;
      }
    },

    /**
     * 同期版パフォーマンス計測
     * @param {string} operation - 操作名
     * @param {Function} fn - 実行する関数
     * @returns {*} 関数の戻り値
     */
    profileSync(operation, fn) {
      const start = Date.now();
      try {
        const result = fn();
        const duration = Date.now() - start;
        this.info(`${operation} completed`, { duration: `${duration}ms` });
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.error(`${operation} failed`, { duration: `${duration}ms`, error: error.message });
        throw error;
      }
    }
  };
}

module.exports = {
  logger,
  createLogger
};
