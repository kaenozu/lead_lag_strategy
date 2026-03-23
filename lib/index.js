/**
 * ライブラリエントリーポイント
 * Library Entry Point
 */

'use strict';

const math = require('./math/index');
const logger = require('./logger');
const config = require('./config');
const pca = require('./pca');
const portfolio = require('./portfolio');
const data = require('./data');

module.exports = {
  // 数学関数
  ...math,

  // ロガー
  ...logger,

  // 設定
  ...config,

  // PCA
  ...pca,

  // ポートフォリオ
  ...portfolio,

  // データ処理
  ...data
};
