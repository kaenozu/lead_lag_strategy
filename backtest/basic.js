/**
 * Backtest module entry point
 * 
 * Available backtest implementations:
 * - index.js: Basic sample-data backtest
 * - real.js: Real market data backtest (from CSV or Yahoo Finance)
 * - improved.js: Improved version with parameter optimization
 * - risk_managed.js: Risk-managed version with volatility controls
 * - analysis.js: Strategy analysis tool
 */

module.exports = {
  // Re-export all backtest implementations
  basic: require('./index'),
  real: require('./real'),
  improved: require('./improved'),
  riskManaged: require('./risk_managed'),
  analysis: require('./analysis')
};
