/**
 * Backtest module entry point
 * 
 * Available backtest implementations:
 * - basic.js: Basic sample-data backtest
 * - real.js: Real market data backtest (from CSV or Yahoo Finance)
 * - improved.js: Improved version with parameter optimization
 * - risk_managed.js: Risk-managed version with volatility controls
 * - analysis.js: Strategy analysis tool
 * 
 * Usage:
 *   node backtest/basic.js      # Run basic backtest
 *   node backtest/real.js       # Run with real data
 *   node backtest/improved.js   # Run with parameter optimization
 *   node backtest/risk_managed.js  # Run with risk management
 *   node backtest/analysis.js   # Run strategy analysis
 */

module.exports = {
  basic: require('./basic'),
  real: require('./real'),
  improved: require('./improved'),
  riskManaged: require('./risk_managed'),
  analysis: require('./analysis')
};
