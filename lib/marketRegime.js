/**
 * 市場環境判定モジュール
 * 強気/弱気相場を判定し、取引を制御
 */

'use strict';

/**
 * 市場環境タイプ
 */
const MarketRegime = {
  BULL: 'bull',      // 強気相場
  BEAR: 'bear',      // 弱気相場
  NEUTRAL: 'neutral' // 中立
};

/**
 * 市場環境設定
 */
const DEFAULT_CONFIG = {
  lookback: 200,              // 移動平均期間（日）
  bullThreshold: 1.05,        // 強気閾値（価格/MA）
  bearThreshold: 0.95,        // 弱気閾値（価格/MA）
  positionSizeBull: 1.0,      // 強気時ポジションサイズ
  positionSizeBear: 0.0,      // 弱気時ポジションサイズ（0=取引停止）
  positionSizeNeutral: 0.5    // 中立時ポジションサイズ
};

/**
 * 市場環境の判定
 * @param {Array} prices - 価格系列（終値）
 * @param {Object} config - 設定
 * @returns {Object} 市場環境判定結果
 */
function determineMarketRegime(prices, config = DEFAULT_CONFIG) {
  if (!prices || prices.length < config.lookback) {
    return {
      regime: MarketRegime.NEUTRAL,
      price: prices?.[prices.length - 1] || 0,
      ma: 0,
      ratio: 0,
      message: 'データ不足'
    };
  }

  // 単純移動平均の計算
  const slice = prices.slice(-config.lookback);
  const ma = slice.reduce((sum, p) => sum + p, 0) / config.lookback;
  const currentPrice = prices[prices.length - 1];
  const ratio = currentPrice / ma;

  // 市場環境判定
  let regime;
  if (ratio >= config.bullThreshold) {
    regime = MarketRegime.BULL;
  } else if (ratio <= config.bearThreshold) {
    regime = MarketRegime.BEAR;
  } else {
    regime = MarketRegime.NEUTRAL;
  }

  return {
    regime,
    price: currentPrice,
    ma,
    ratio,
    positionSize: getPositionSize(regime, config),
    message: getMessage(regime, ratio)
  };
}

/**
 * ポジションサイズの取得
 */
function getPositionSize(regime, config = DEFAULT_CONFIG) {
  switch (regime) {
    case MarketRegime.BULL:
      return config.positionSizeBull;
    case MarketRegime.BEAR:
      return config.positionSizeBear;
    default:
      return config.positionSizeNeutral;
  }
}

/**
 * メッセージ生成
 */
function getMessage(regime, ratio) {
  const pct = ((ratio - 1) * 100).toFixed(1);
  switch (regime) {
    case MarketRegime.BULL:
      return `強気相場（+${pct}%）- 通常取引`;
    case MarketRegime.BEAR:
      return `弱気相場（${pct}%）- 取引停止または縮小`;
    default:
      return `中立相場（${pct > 0 ? '+' : ''}${pct}%）- ポジション 50%`;
  }
}

module.exports = {
  MarketRegime,
  determineMarketRegime,
  getPositionSize,
  DEFAULT_CONFIG
};
