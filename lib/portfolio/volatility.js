'use strict';

/**
 * ボラティリティ・ターゲティング
 * Volatility Targeting for Position Sizing
 * 
 * 参考文献:
 * - Grinold & Kahn (2000) "Active Portfolio Management"
 * - J.P. Morgan RiskMetrics (1996)
 */

const { createLogger } = require('../logger');

const logger = createLogger('VolatilityTarget');

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG = {
  targetVolatility: 0.10,        // 年率 10%
  lookbackDays: 20,              // 20 日（1 ヶ月）
  maxPosition: 1.5,              // 最大ポジション 150%
  minPosition: 0.5,              // 最小ポジション 50%
  volCap: 0.30,                  // ボラティリティ上限 30%
  floorVol: 0.05                 // ボラティリティ下限 5%
};

/**
 * 実現ボラティリティの計算
 * 
 * @param {Array<Array<number>>} returns - 日次リターン行列 [days][assets]
 * @param {number} lookback - 期間（日）
 * @returns {Array<number>} 各資産のボラティリティ（年率）
 */
function calculateRealizedVolatility(returns, lookback = 20) {
  if (!returns || returns.length === 0) {
    logger.warn('calculateRealizedVolatility: empty returns');
    return [];
  }

  const nAssets = returns[0].length;
  const nDays = Math.min(lookback, returns.length);
  
  // 直近 n 日のデータを使用
  const recentReturns = returns.slice(-nDays);
  
  const vols = [];
  
  for (let i = 0; i < nAssets; i++) {
    // 各資産の時系列リターン
    const assetReturns = recentReturns.map(row => row[i]).filter(r => r !== null && r !== undefined);
    
    if (assetReturns.length < 5) {
      vols.push(0.20);  // デフォルト 20%
      continue;
    }
    
    // 平均リターン
    const mean = assetReturns.reduce((a, b) => a + b, 0) / assetReturns.length;
    
    // 分散
    const variance = assetReturns.reduce((sum, r) => {
      return sum + Math.pow(r - mean, 2);
    }, 0) / (assetReturns.length - 1);
    
    // 日次ボラティリティ
    const dailyVol = Math.sqrt(variance);
    
    // 年率換算（252 営業日）
    const annualVol = dailyVol * Math.sqrt(252);
    
    vols.push(annualVol);
  }
  
  return vols;
}

/**
 * ポートフォリオ全体のボラティリティ計算
 * 
 * @param {Array<Array<number>>} returns - リターン行列
 * @param {Array<number>} weights - ポートフォリオウェイト
 * @param {number} lookback - 期間
 * @returns {number} ポートフォリオボラティリティ（年率）
 */
function calculatePortfolioVolatility(returns, weights, lookback = 20) {
  if (!returns || returns.length === 0 || !weights || weights.length === 0) {
    return 0.10;  // デフォルト
  }
  
  const nDays = Math.min(lookback, returns.length);
  const recentReturns = returns.slice(-nDays);
  
  // ポートフォリオリターン
  const portReturns = [];
  
  for (const row of recentReturns) {
    let portRet = 0;
    for (let i = 0; i < weights.length; i++) {
      if (row[i] !== null && row[i] !== undefined) {
        portRet += weights[i] * row[i];
      }
    }
    portReturns.push(portRet);
  }
  
  if (portReturns.length < 5) {
    return 0.10;
  }
  
  // 平均リターン
  const mean = portReturns.reduce((a, b) => a + b, 0) / portReturns.length;
  
  // 分散
  const variance = portReturns.reduce((sum, r) => {
    return sum + Math.pow(r - mean, 2);
  }, 0) / (portReturns.length - 1);
  
  // 日次ボラティリティ
  const dailyVol = Math.sqrt(variance);
  
  // 年率換算
  return dailyVol * Math.sqrt(252);
}

/**
 * ボラティリティ・ターゲティングによるポジション調整
 * 
 * @param {Array<number>} baseWeights - 基本ウェイト
 * @param {Array<Array<number>>} returns - リターン行列
 * @param {Object} config - 設定
 * @returns {Object} { adjustedWeights, scalingFactor, currentVol, targetVol }
 */
function applyVolatilityTargeting(baseWeights, returns, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // 現在ボラティリティ計算
  const currentVol = calculatePortfolioVolatility(returns, baseWeights, cfg.lookbackDays);
  
  // ボラティリティの下限・上限制限
  const cappedVol = Math.max(cfg.floorVol, Math.min(cfg.volCap, currentVol));
  
  // スケーリング係数
  let scalingFactor = cfg.targetVolatility / cappedVol;
  
  // ポジション制限
  scalingFactor = Math.max(cfg.minPosition, Math.min(cfg.maxPosition, scalingFactor));
  
  // ウェイト調整
  const adjustedWeights = baseWeights.map(w => w * scalingFactor);
  
  // 合計ウェイトの再正規化（グロス制限）
  const grossExposure = adjustedWeights.reduce((sum, w) => sum + Math.abs(w), 0);
  const netExposure = adjustedWeights.reduce((sum, w) => sum + w, 0);
  
  logger.info('Volatility targeting applied', {
    currentVol: (currentVol * 100).toFixed(2) + '%',
    targetVol: (cfg.targetVolatility * 100).toFixed(2) + '%',
    scalingFactor: scalingFactor.toFixed(3),
    grossExposure: (grossExposure * 100).toFixed(2) + '%',
    netExposure: (netExposure * 100).toFixed(2) + '%'
  });
  
  return {
    adjustedWeights,
    scalingFactor,
    currentVol,
    targetVol: cfg.targetVolatility,
    grossExposure,
    netExposure
  };
}

/**
 * 動的ルックバック期間の計算
 * 
 * ボラティリティが高い → 短期間で反応
 * ボラティリティが低い → 長期間で安定
 * 
 * @param {number} currentVol - 現在ボラティリティ
 * @param {number} baseLookback - 基本ルックバック
 * @returns {number} 動的ルックバック
 */
function getDynamicLookback(currentVol, baseLookback = 20) {
  if (currentVol > 0.25) {
    return Math.max(10, Math.floor(baseLookback * 0.5));  // 高ボラ：短期
  }
  if (currentVol < 0.10) {
    return Math.min(40, Math.floor(baseLookback * 2.0));  // 低ボラ：長期
  }
  return baseLookback;  // 通常
}

/**
 * カリー基準による最適レバレッジ計算
 * 
 * @param {number} expectedReturn - 期待リターン（年率）
 * @param {number} volatility - ボラティリティ（年率）
 * @param {number} riskFreeRate - リスクフリーレート
 * @returns {number} 最適レバレッジ
 */
function calculateKellyLeverage(expectedReturn, volatility, riskFreeRate = 0.001) {
  if (volatility <= 0) {
    return 1.0;
  }
  
  const excessReturn = expectedReturn - riskFreeRate;
  const variance = Math.pow(volatility, 2);
  
  // カリー基準：f* = (μ - r) / σ²
  const kellyFraction = excessReturn / variance;
  
  // レバレッジ制限（0.5-2.0 倍）
  return Math.max(0.5, Math.min(2.0, kellyFraction));
}

/**
 * ボラティリティ調整後シャープレシオ計算
 * 
 * @param {Array<number>} returns - ポートフォオリターン
 * @param {number} targetVol - ターゲットボラティリティ
 * @returns {Object} { sharpe, adjustedSharpe, vol }
 */
function calculateVolatilityAdjustedMetrics(returns, targetVol = 0.10) {
  if (!returns || returns.length < 10) {
    return { sharpe: 0, adjustedSharpe: 0, vol: 0 };
  }
  
  // 平均リターン（年率）
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
  
  // ボラティリティ（年率）
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - returns.reduce((a, b) => a + b, 0) / returns.length, 2), 0) / (returns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252);
  
  // シャープレシオ
  const sharpe = vol > 0 ? (meanReturn - 0.001) / vol : 0;
  
  // ボラティリティ調整後リターン
  const adjustedReturn = meanReturn * (targetVol / vol);
  
  // 調整後シャープレシオ
  const adjustedSharpe = vol > 0 ? (adjustedReturn - 0.001) / targetVol : 0;
  
  return {
    sharpe,
    adjustedSharpe,
    vol,
    meanReturn,
    adjustedReturn
  };
}

module.exports = {
  calculateRealizedVolatility,
  calculatePortfolioVolatility,
  applyVolatilityTargeting,
  getDynamicLookback,
  calculateKellyLeverage,
  calculateVolatilityAdjustedMetrics,
  DEFAULT_CONFIG
};
