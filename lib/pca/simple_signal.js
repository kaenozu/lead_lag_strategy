'use strict';

const { createLogger } = require('../logger');
const {
  computeColumnStats,
  computeSignalMoments,
  safeNormalizeSignal,
  marketAverage
} = require('./signal_utils');

const logger = createLogger('SimpleLeadLagSignal');

/**
 * シンプル・リードラグシグナル
 * US市場のリーダー的存在を利用した直接的な戦略
 */
class SimpleLeadLagSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.minCorrelation = config.minCorrelation || 0.05;
  }

  /**
   * シグナル計算
   * @param {Array<Array<number>>} returnsUs - USリターン（窗口×nUs）
   * @param {Array<Array<number>>} returnsJp - JPリターン（窗口×nJp）
   * @param {Array<number>} returnsUsLatest - US最新リターン（t-1）
   * @param {Object} sectorLabels - 未使用（API互換性のため）
   * @param {Array<Array<number>>} CFull - 未使用（API互換性のため）
   * @returns {Array<number>} JP各セクターのシグナル
   */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, _sectorLabels, _CFull) {
    try {
      if (!returnsUs || !returnsJp || !returnsUsLatest) {
        throw new Error('Invalid input: returns data is missing');
      }
      if (returnsUs.length < 10 || returnsJp.length < 10) {
        throw new Error('Insufficient data for signal computation');
      }

      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      const { mean: usMean, std: usStd } = computeColumnStats(returnsUs);
      const { mean: jpMean, std: jpStd } = computeColumnStats(returnsJp);

      const signal = new Array(nJp).fill(0);

      for (let i = 0; i < nSamples - 1; i++) {
        const usPrev = returnsUs[i];
        const jpCurr = returnsJp[i + 1];

        for (let u = 0; u < nUs; u++) {
          for (let j = 0; j < nJp; j++) {
            const usZ = (usPrev[u] - usMean[u]) / usStd[u];
            const jpZ = (jpCurr[j] - jpMean[j]) / jpStd[j];
            const corr = usZ * jpZ;

            if (Math.abs(corr) > this.minCorrelation) {
              const usSign = usPrev[u] > 0 ? 1 : usPrev[u] < 0 ? -1 : 0;
              signal[j] += usSign * corr;
            }
          }
        }
      }

      const signalNormalized = safeNormalizeSignal(signal);
      const { mean: signalMean, std: signalStd } = computeSignalMoments(signal);

      logger.debug('Simple lead-lag signal computed', {
        signalMean,
        signalStd
      });

      return signalNormalized;
    } catch (error) {
      logger.error('Failed to compute simple lead-lag signal', { error: error.message });
      throw error;
    }
  }
}

/**
 * ベータベース・リードラグシグナル
 * US市場のベータを使ったシンプルな戦略
 */
class BetaBasedSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
  }

  computeSignal(returnsUs, returnsJp, returnsUsLatest, _sectorLabels, _CFull) {
    try {
      if (!returnsUs || !returnsJp || !returnsUsLatest) {
        throw new Error('Invalid input: returns data is missing');
      }
      if (returnsUs.length < 10 || returnsJp.length < 10) {
        throw new Error('Insufficient data for signal computation');
      }

      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      const usMarketReturn = returnsUs.map(marketAverage);

      const usMarketMean = usMarketReturn.reduce((a, b) => a + b, 0) / nSamples;
      let sumSqUs = 0;
      for (let i = 0; i < nSamples; i++) {
        const diff = usMarketReturn[i] - usMarketMean;
        sumSqUs += diff * diff;
      }
      const usMarketStd = Math.sqrt(sumSqUs / nSamples) + 1e-10;

      const signal = new Array(nJp).fill(0);

      for (let j = 0; j < nJp; j++) {
        let cov = 0;
        for (let i = 0; i < nSamples; i++) {
          const usZ = (usMarketReturn[i] - usMarketMean) / usMarketStd;
          const jpZ = (returnsJp[i][j] - (returnsJp.reduce((sum, row) => sum + row[j], 0) / nSamples)) / 
                      (Math.sqrt(returnsJp.reduce((sumSq, row) => sumSq + row[j] * row[j], 0) / nSamples) + 1e-10);
          cov += usZ * jpZ;
        }
        cov /= nSamples;

        const usMarketSign = usMarketReturn[nSamples - 1] > 0 ? 1 : usMarketReturn[nSamples - 1] < 0 ? -1 : 0;
        signal[j] = cov * usMarketSign;
      }

      return signal;
    } catch (error) {
      logger.error('Failed to compute beta-based signal', { error: error.message });
      throw error;
    }
  }
}

module.exports = {
  SimpleLeadLagSignal,
  BetaBasedSignal
};
