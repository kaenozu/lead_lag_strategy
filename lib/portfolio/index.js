'use strict';

const {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio
} = require('./build');

const {
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('./metrics');

const {
  applyTransactionCosts,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdownDetail
} = require('./risk');

module.exports = {
  buildPortfolio,
  buildDoubleSortPortfolio,
  buildEqualWeightPortfolio,
  computePerformanceMetrics,
  computeYearlyPerformance,
  computeRollingMetrics,
  applyTransactionCosts,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdownDetail
};
