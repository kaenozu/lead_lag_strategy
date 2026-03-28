'use strict';

/**
 * マルチファクターシグナル
 * Multi-Factor Signals for Lead-Lag Strategy
 * 
 * 参考文献:
 * - Fama & French (1992, 1993) - Three Factor Model
 * - Carhart (1997) - Four Factor Model
 * - AQR Capital Research
 */

const { createLogger } = require('../logger');

const logger = createLogger('MultiFactor');

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG = {
  momentumLookback: 252,         // 12 ヶ月
  momentumSkip: 21,              // 直近 1 ヶ月スキップ（短期リバース）
  qualityLookback: 252,          // 1 年
  valueLookback: 252,            // 1 年
  volatilityLookback: 63         // 3 ヶ月
};

/**
 * モメンタムファクター
 * 
 * 12-1 ヶ月リターン（直近 1 ヶ月を除外）
 * 
 * @param {Array<number>} prices - 価格時系列
 * @param {Object} config - 設定
 * @returns {number} モメンタムスコア
 */
function calculateMomentum(prices, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (!prices || prices.length < cfg.momentumLookback) {
    return 0;  // データ不足
  }
  
  const currentPrice = prices[prices.length - 1];
  const pastPrice = prices[prices.length - 1 - cfg.momentumLookback];
  const skipPrice = prices[prices.length - 1 - cfg.momentumSkip];

  // 12-1 ヶ月リターン（幾何リターン）
  const totalReturn = Math.log(currentPrice / pastPrice);
  const recentReturn = Math.log(currentPrice / skipPrice);

  // 直近 1 ヶ月を除外（Jegadeesh & Titman, 1993）
  const momentum12m1m = totalReturn - recentReturn;

  return momentum12m1m;
}

/**
 * クオリティファクター
 * 
 * ROE, 利益率, 負債比率の複合スコア
 * 
 * @param {Object} fundamentals - ファンダメンタルデータ
 * @returns {number} クオリティスコア
 */
function calculateQuality(fundamentals) {
  if (!fundamentals) {
    return 0;
  }
  
  const {
    roe = 0,           // 自己資本利益率
    profitMargin = 0,  // 純利益率
    debtToEquity = 1,  // 負債資本比率
    roa = 0            // 総資産利益率
  } = fundamentals;
  
  // 各メトリクスのスコア化（業界平均との比較を想定）
  // ここでは簡易的に 0-1 スコアに変換
  
  // ROE スコア（15% で 1.0）
  const roeScore = Math.max(0, Math.min(1, roe / 0.15));
  
  // 利益率スコア（20% で 1.0）
  const marginScore = Math.max(0, Math.min(1, profitMargin / 0.20));
  
  // 負債比率スコア（低いほど良い、0.5 で 0.5）
  const debtScore = Math.max(0, 1 - debtToEquity);
  
  // ROA スコア（10% で 1.0）
  const roaScore = Math.max(0, Math.min(1, roa / 0.10));
  
  // 加重平均
  const qualityScore = (
    roeScore * 0.40 +
    marginScore * 0.25 +
    debtScore * 0.20 +
    roaScore * 0.15
  );
  
  return qualityScore;
}

/**
 * バリューファクター
 * 
 * PER, PBR, PCR の複合スコア
 * 
 * @param {Object} fundamentals - ファンダメンタルデータ
 * @returns {number} バリュースコア
 */
function calculateValue(fundamentals) {
  if (!fundamentals) {
    return 0;
  }
  
  const {
    per = 20,          // 株価収益率
    pbr = 1.5,         // 株価純資産倍率
    pcr = 10,          // 株価キャッシュフロー倍率
    evEbitda = 10      // 企業価値倍率
  } = fundamentals;
  
  // 各メトリクスのスコア化（低いほど良い）
  // 業界平均との比較を想定
  
  // PER スコア（15 倍で 0.5、5 倍で 1.0）
  const perScore = Math.max(0, Math.min(1, (25 - per) / 20));
  
  // PBR スコア（1 倍で 0.5、0.5 倍で 1.0）
  const pbrScore = Math.max(0, Math.min(1, (2 - pbr) / 1.5));
  
  // PCR スコア（10 倍で 0.5、5 倍で 1.0）
  const pcrScore = Math.max(0, Math.min(1, (15 - pcr) / 10));
  
  // EV/EBITDA スコア（8 倍で 0.5、4 倍で 1.0）
  const evEbitdaScore = Math.max(0, Math.min(1, (12 - evEbitda) / 8));
  
  // 加重平均
  const valueScore = (
    perScore * 0.30 +
    pbrScore * 0.30 +
    pcrScore * 0.20 +
    evEbitdaScore * 0.20
  );
  
  return valueScore;
}

/**
 * ボラティリティファクター
 * 
 * 低ボラティリティ株はアウトパフォームする傾向
 * 
 * @param {Array<number>} returns - リターン時系列
 * @param {Object} config - 設定
 * @returns {number} ボラティリティスコア（高いほど良い＝低ボラ）
 */
function calculateVolatilityFactor(returns, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (!returns || returns.length < cfg.volatilityLookback) {
    return 0.5;  // 中立
  }
  
  const recentReturns = returns.slice(-cfg.volatilityLookback);
  
  // 平均リターン
  const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  
  // 分散
  const variance = recentReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (recentReturns.length - 1);
  
  // 日次ボラティリティ
  const dailyVol = Math.sqrt(variance);
  
  // 年率ボラティリティ
  const annualVol = dailyVol * Math.sqrt(252);
  
  // スコア化（20% で 0.5、10% で 1.0）
  // 低いボラティリティほど高いスコア
  const volScore = Math.max(0, Math.min(1, (0.30 - annualVol) / 0.20));
  
  return volScore;
}

/**
 * リスク調整後モメンタム
 * 
 * モメンタムをボラティリティで調整
 * 
 * @param {number} momentum - モメンタム
 * @param {number} volatility - ボラティリティ
 * @returns {number} リスク調整後モメンタム
 */
function calculateRiskAdjustedMomentum(momentum, volatility) {
  if (volatility <= 0) {
    return momentum;
  }
  
  // シャープレシオ形式
  const riskAdjustedMom = momentum / volatility;
  
  // 標準化（-2 から 2 の範囲）
  return Math.max(-2, Math.min(2, riskAdjustedMom));
}

/**
 * マルチファクター統合シグナル
 * 
 * @param {Object} factors - 各ファクタースコア
 * @param {Object} weights - 重み
 * @returns {number} 統合スコア
 */
function combineFactors(factors, weights = {}) {
  const defaultWeights = {
    momentum: 0.30,
    quality: 0.25,
    value: 0.25,
    volatility: 0.20
  };
  
  const w = { ...defaultWeights, ...weights };
  
  // 正規化（重みの合計を 1 に）
  const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
  const normalizedWeights = Object.fromEntries(
    Object.entries(w).map(([k, v]) => [k, v / totalWeight])
  );
  
  // 加重平均
  const combinedSignal = (
    (factors.momentum || 0) * normalizedWeights.momentum +
    (factors.quality || 0) * normalizedWeights.quality +
    (factors.value || 0) * normalizedWeights.value +
    (factors.volatility || 0) * normalizedWeights.volatility
  );
  
  return combinedSignal;
}

/**
 * ファクター中立化
 * 
 * 特定ファクターのエクスポージャーを除去
 * 
 * @param {Array<number>} signals - 元シグナル
 * @param {Array<number>} factorExposures - ファクターエクスポージャー
 * @returns {Array<number>} 中立化シグナル
 */
function neutralizeFactor(signals, factorExposures) {
  if (!signals || !factorExposures || signals.length !== factorExposures.length) {
    return signals || [];
  }
  
  // 単純な線形回帰でファクターエクスポージャーを除去
  const n = signals.length;
  
  // 平均
  const signalMean = signals.reduce((a, b) => a + b, 0) / n;
  const factorMean = factorExposures.reduce((a, b) => a + b, 0) / n;
  
  // 共分散・分散
  let covariance = 0;
  let factorVariance = 0;
  
  for (let i = 0; i < n; i++) {
    const signalDev = signals[i] - signalMean;
    const factorDev = factorExposures[i] - factorMean;
    
    covariance += signalDev * factorDev;
    factorVariance += Math.pow(factorDev, 2);
  }
  
  // 回帰係数
  const beta = factorVariance > 0 ? covariance / factorVariance : 0;
  
  // 中立化シグナル
  const neutralizedSignals = signals.map((s, i) => {
    return s - beta * (factorExposures[i] - factorMean);
  });
  
  return neutralizedSignals;
}

/**
 * ファクターパリティポートフォリオ
 * 
 * 各ファクターに均等にエクスポージャー
 * 
 * @param {Array<Object>} factorScores - 各銘柄のファクタースコア
 * @returns {Array<number>} ウェイト
 */
function buildFactorParityPortfolio(factorScores) {
  if (!factorScores || factorScores.length === 0) {
    return [];
  }
  
  const n = factorScores.length;
  
  // 各ファクターの平均スコア
  const factorMeans = {
    momentum: factorScores.reduce((a, s) => a + (s.momentum || 0), 0) / n,
    quality: factorScores.reduce((a, s) => a + (s.quality || 0), 0) / n,
    value: factorScores.reduce((a, s) => a + (s.value || 0), 0) / n,
    volatility: factorScores.reduce((a, s) => a + (s.volatility || 0), 0) / n
  };
  
  // 各ファクターからの距離
  const distances = factorScores.map(s => {
    return Math.sqrt(
      Math.pow((s.momentum || 0) - factorMeans.momentum, 2) +
      Math.pow((s.quality || 0) - factorMeans.quality, 2) +
      Math.pow((s.value || 0) - factorMeans.value, 2) +
      Math.pow((s.volatility || 0) - factorMeans.volatility, 2)
    );
  });
  
  // 距離が近いほど高いウェイト（逆数）
  const weights = distances.map(d => {
    const invDist = d > 0 ? 1 / d : 1;
    return invDist;
  });
  
  // 正規化
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / totalWeight);
}

/**
 * ファクター相関行列
 * 
 * @param {Array<Array<number>>} factorReturns - ファクターリターン
 * @returns {Array<Array<number>>} 相関行列
 */
function calculateFactorCorrelation(factorReturns) {
  if (!factorReturns || factorReturns.length === 0) {
    return [];
  }
  
  const nFactors = factorReturns.length;
  const nPeriods = factorReturns[0].length;
  
  // 平均リターン
  const means = factorReturns.map(fr => {
    return fr.reduce((a, b) => a + b, 0) / nPeriods;
  });
  
  // 標準偏差
  const stds = factorReturns.map((fr, i) => {
    const variance = fr.reduce((sum, r) => sum + Math.pow(r - means[i], 2), 0) / (nPeriods - 1);
    return Math.sqrt(variance);
  });
  
  // 相関行列
  const correlation = [];
  for (let i = 0; i < nFactors; i++) {
    correlation[i] = [];
    for (let j = 0; j < nFactors; j++) {
      if (i === j) {
        correlation[i][j] = 1;
      } else {
        // 共分散
        let covariance = 0;
        for (let k = 0; k < nPeriods; k++) {
          covariance += (factorReturns[i][k] - means[i]) * (factorReturns[j][k] - means[j]);
        }
        covariance /= (nPeriods - 1);
        
        // 相関
        correlation[i][j] = covariance / (stds[i] * stds[j]);
      }
    }
  }
  
  return correlation;
}

module.exports = {
  calculateMomentum,
  calculateQuality,
  calculateValue,
  calculateVolatilityFactor,
  calculateRiskAdjustedMomentum,
  combineFactors,
  neutralizeFactor,
  buildFactorParityPortfolio,
  calculateFactorCorrelation,
  DEFAULT_CONFIG
};
