/**
 * ポートフォリオ構築ユーティリティ
 * Portfolio Building Utilities with Enhanced Performance
 * 
 * @deprecated Use lib/portfolio/ instead
 */

'use strict';

const build = require('./portfolio/build');
const metrics = require('./portfolio/metrics');
const risk = require('./portfolio/risk');

module.exports = {
  ...build,
  ...metrics,
  ...risk
};
