'use strict';

const { DEFAULT_VOL_EXPOSURE, DEFAULT_EQUITY_DD_SCALING } = require('../riskExposure');

/**
 * ペーパー日次向け: バックテスト `BACKTEST_CONFIG` と揃えた曝露縮小の既定値を返す。
 * （weights の自動縮小はシグナル生成に未組み込みのため、運用判断の参照用）
 */
function paperExposureGuidance() {
  return {
    source: 'lib/riskExposure + scripts/backtest_with_market_regime BACKTEST_CONFIG',
    volExposure: {
      ...DEFAULT_VOL_EXPOSURE,
      enabled: true,
      lookback: 20,
      refAnnualVol: 0.12,
      capAnnualVol: 0.30,
      minScale: 0.4,
      maxScale: 1.0
    },
    equityDrawdownScaling: {
      ...DEFAULT_EQUITY_DD_SCALING,
      enabled: true,
      softDrawdown: 0.08,
      hardDrawdown: 0.18,
      scaleAtSoft: 1.0,
      scaleAtHard: 0.35
    }
  };
}

module.exports = {
  paperExposureGuidance
};
