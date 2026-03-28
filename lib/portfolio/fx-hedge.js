'use strict';

/**
 * 為替ヘッジ管理
 * FX Hedging for Japan-US Lead-Lag Strategy
 * 
 * 参考文献:
 * - Black (1990) "Equilibrium Exchange Rate Hedging"
 * - Perold & Schulman (1988) "The Free Lunch in Currency Hedging"
 */

const { createLogger } = require('../logger');
const { fetchOhlcvForTickers } = require('../data');

const logger = createLogger('FXHedge');

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG = {
  hedgeRatio: 0.90,              // 90% ヘッジ
  hedgeInstrument: 'forward',    // 'forward', 'future', 'etf'
  hedgeCost: 0.0075,             // 年率 0.75%（ヘッジコスト）
  rebalanceThreshold: 0.05,      // 5% 乖離でリバランス
  usdJpyTicker: 'USDJPY=X'       // 為替チッカー
};

/**
 * 為替ポジション計算
 * 
 * @param {number} jpExposure - 日本エクスポージャー（円）
 * @param {number} usExposure - 米国エクスポージャー（ドル）
 * @param {number} hedgeRatio - ヘッジ比率
 * @returns {Object} { netExposure, hedgeAmount, remainingExposure }
 */
function calculateFXPosition(jpExposure, usExposure, hedgeRatio = 0.90) {
  // 正味エクスポージャー（ドルベース）
  const netExposure = usExposure - jpExposure;
  
  // ヘッジ必要量
  const hedgeAmount = netExposure * hedgeRatio;
  
  // ヘッジ後エクスポージャー
  const remainingExposure = netExposure - hedgeAmount;
  
  logger.debug('FX position calculated', {
    jpExposure: jpExposure.toFixed(2),
    usExposure: usExposure.toFixed(2),
    netExposure: netExposure.toFixed(2),
    hedgeRatio: (hedgeRatio * 100).toFixed(1) + '%',
    hedgeAmount: hedgeAmount.toFixed(2),
    remainingExposure: remainingExposure.toFixed(2)
  });
  
  return {
    netExposure,
    hedgeAmount,
    remainingExposure
  };
}

/**
 * 為替ヘッジコスト計算
 * 
 * @param {number} hedgeAmount - ヘッジ金額
 * @param {number} annualCost - 年間コスト（比率）
 * @param {number} holdingDays - 保有日数
 * @returns {number} ヘッジコスト
 */
function calculateHedgeCost(hedgeAmount, annualCost = 0.0075, holdingDays = 1) {
  const dailyCost = annualCost / 252;
  const cost = Math.abs(hedgeAmount) * dailyCost * holdingDays;
  
  logger.debug('Hedge cost calculated', {
    hedgeAmount: hedgeAmount.toFixed(2),
    annualCost: (annualCost * 100).toFixed(2) + '%',
    holdingDays,
    cost: cost.toFixed(4)
  });
  
  return cost;
}

/**
 * 為替リターンの計算
 * 
 * @param {Array<number>} usdReturns - ドル建てリターン
 * @param {Array<number>} fxReturns - 為替リターン（円高プラス）
 * @param {number} hedgeRatio - ヘッジ比率
 * @returns {Array<number>} ヘッジ後リターン（円建て）
 */
function calculateHedgedReturns(usdReturns, fxReturns, hedgeRatio = 0.90) {
  if (!usdReturns || !fxReturns || usdReturns.length !== fxReturns.length) {
    logger.warn('calculateHedgedReturns: invalid inputs');
    return usdReturns || [];
  }
  
  const hedgedReturns = [];
  
  for (let i = 0; i < usdReturns.length; i++) {
    // ドル建てリターン
    const usdRet = usdReturns[i] || 0;
    
    // 為替リターン（円建て換算）
    // 円高：プラス、円安：マイナス
    const fxRet = fxReturns[i] || 0;
    
    // ヘッジ後リターン
    // ヘッジ比率分は為替影響を相殺
    const hedgedRet = usdRet + (1 - hedgeRatio) * fxRet;
    
    hedgedReturns.push(hedgedRet);
  }
  
  return hedgedReturns;
}

/**
 * 為替ボラティリティの計算
 * 
 * @param {Array<number>} fxReturns - 為替リターン
 * @param {number} lookback - 期間
 * @returns {number} 為替ボラティリティ（年率）
 */
function calculateFXVolatility(fxReturns, lookback = 20) {
  if (!fxReturns || fxReturns.length < 5) {
    return 0.10;  // デフォルト 10%
  }
  
  const recent = fxReturns.slice(-lookback);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (recent.length - 1);
  
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * 最適ヘッジ比率の計算（最小分散ヘッジ）
 * 
 * @param {Array<number>} assetReturns - 資産リターン
 * @param {Array<number>} fxReturns - 為替リターン
 * @param {number} lookback - 期間
 * @returns {number} 最適ヘッジ比率
 */
function calculateOptimalHedgeRatio(assetReturns, fxReturns, lookback = 60) {
  if (!assetReturns || !fxReturns || assetReturns.length < 10 || fxReturns.length < 10) {
    return 0.90;  // デフォルト
  }
  
  const n = Math.min(lookback, assetReturns.length, fxReturns.length);
  const asset = assetReturns.slice(-n);
  const fx = fxReturns.slice(-n);
  
  // 共分散
  const assetMean = asset.reduce((a, b) => a + b, 0) / n;
  const fxMean = fx.reduce((a, b) => a + b, 0) / n;
  
  let covariance = 0;
  let fxVariance = 0;
  
  for (let i = 0; i < n; i++) {
    const assetDev = asset[i] - assetMean;
    const fxDev = fx[i] - fxMean;
    
    covariance += assetDev * fxDev;
    fxVariance += Math.pow(fxDev, 2);
  }
  
  covariance /= (n - 1);
  fxVariance /= (n - 1);
  
  // 最適ヘッジ比率 = Cov(Asset, FX) / Var(FX)
  if (fxVariance <= 0) {
    return 0.90;
  }
  
  const optimalHedge = covariance / fxVariance;
  
  // ヘッジ比率制限（0-1.5）
  return Math.max(0, Math.min(1.5, optimalHedge));
}

/**
 * 為替ヘッジシグナル生成
 * 
 * @param {Object} portfolio - ポートフォリオ情報
 * @param {Array<number>} fxReturns - 為替リターン
 * @param {Object} config - 設定
 * @returns {Object} ヘッジ指示
 */
function generateHedgeSignal(portfolio, fxReturns, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const {
    jpExposure = 0,
    usExposure = 0,
    currentHedge = 0
  } = portfolio;
  
  // 現在為替ボラティリティ
  const fxVol = calculateFXVolatility(fxReturns, cfg.lookback);
  
  // 動的ヘッジ比率（高ボラ時はヘッジ強化）
  let dynamicHedgeRatio = cfg.hedgeRatio;
  if (fxVol > 0.15) {
    dynamicHedgeRatio = Math.min(1.0, cfg.hedgeRatio + 0.10);  // +10%
  } else if (fxVol < 0.08) {
    dynamicHedgeRatio = Math.max(0.70, cfg.hedgeRatio - 0.10);  // -10%
  }
  
  // 最適ヘッジ比率計算
  const assetReturns = portfolio.returns || [];
  const optimalHedge = calculateOptimalHedgeRatio(assetReturns, fxReturns);
  
  // 最終ヘッジ比率（加重平均）
  const finalHedgeRatio = 0.7 * dynamicHedgeRatio + 0.3 * optimalHedge;
  
  // 必要ヘッジ量
  const { hedgeAmount: requiredHedge } = calculateFXPosition(jpExposure, usExposure, finalHedgeRatio);
  
  // 現在ヘッジとの乖離
  const hedgeGap = requiredHedge - currentHedge;
  
  // リバランス判断
  const rebalanceNeeded = Math.abs(hedgeGap) > Math.abs(usExposure) * cfg.rebalanceThreshold;
  
  // ヘッジコスト（日次）
  const dailyHedgeCost = calculateHedgeCost(requiredHedge, cfg.hedgeCost, 1);
  
  const signal = {
    action: rebalanceNeeded ? (hedgeGap > 0 ? 'INCREASE_HEDGE' : 'DECREASE_HEDGE') : 'HOLD',
    hedgeRatio: finalHedgeRatio,
    hedgeAmount: requiredHedge,
    hedgeGap,
    rebalanceNeeded,
    fxVolatility: fxVol,
    dailyHedgeCost,
    annualHedgeCost: dailyHedgeCost * 252
  };
  
  logger.info('FX hedge signal generated', {
    action: signal.action,
    hedgeRatio: (signal.hedgeRatio * 100).toFixed(1) + '%',
    hedgeAmount: signal.hedgeAmount.toFixed(2),
    fxVol: (signal.fxVolatility * 100).toFixed(2) + '%'
  });
  
  return signal;
}

/**
 * 為替データ取得
 * 
 * @param {number} days - 取得日数
 * @returns {Array<number>} 為替リターン（円建て：USDJPY）
 */
async function fetchFXReturns(days = 252) {
  try {
    const result = await fetchOhlcvForTickers(
      ['USDJPY=X'],
      days,
      { mode: 'yahoo' }
    );
    
    const fxData = result.byTicker['USDJPY=X'];
    
    if (!fxData || fxData.length === 0) {
      logger.warn('Failed to fetch FX data, using default');
      return new Array(days).fill(0);
    }
    
    // 為替リターン計算（円建て：USDJPY が上がれば円安、下がれば円高）
    const fxReturns = [];
    for (let i = 1; i < fxData.length; i++) {
      const prevClose = fxData[i - 1].close;
      const currClose = fxData[i].close;
      
      // 円建てリターン：円高でプラス（日本投資家視点）
      // USDJPY 下落 = 円高 = プラスリターン
      const fxRet = (prevClose - currClose) / prevClose;
      
      fxReturns.push(fxRet);
    }
    
    return fxReturns;
  } catch (error) {
    logger.error('Failed to fetch FX returns', { error: error.message });
    return new Array(days).fill(0);
  }
}

/**
 * ヘッジ後パフォーマンス計算
 * 
 * @param {Array<number>} usdReturns - ドル建てリターン
 * @param {Array<number>} fxReturns - 為替リターン
 * @param {number} hedgeRatio - ヘッジ比率
 * @returns {Object} パフォーマンス比較
 */
function calculateHedgedPerformance(usdReturns, fxReturns, hedgeRatio = 0.90) {
  const hedgedReturns = calculateHedgedReturns(usdReturns, fxReturns, hedgeRatio);
  
  // 統計量計算
  const stats = (returns) => {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - returns.reduce((a, b) => a + b, 0) / returns.length, 2), 0) / (returns.length - 1);
    const vol = Math.sqrt(variance) * Math.sqrt(252);
    const sharpe = vol > 0 ? (mean - 0.001) / vol : 0;
    return { mean, vol, sharpe };
  };
  
  const unhedgedStats = stats(usdReturns);
  const hedgedStats = stats(hedgedReturns);
  
  return {
    unhedged: unhedgedStats,
    hedged: hedgedStats,
    improvement: {
      return: hedgedStats.mean - unhedgedStats.mean,
      vol: hedgedStats.vol - unhedgedStats.vol,
      sharpe: hedgedStats.sharpe - unhedgedStats.sharpe
    },
    hedgeRatio
  };
}

module.exports = {
  calculateFXPosition,
  calculateHedgeCost,
  calculateHedgedReturns,
  calculateFXVolatility,
  calculateOptimalHedgeRatio,
  generateHedgeSignal,
  fetchFXReturns,
  calculateHedgedPerformance,
  DEFAULT_CONFIG
};
