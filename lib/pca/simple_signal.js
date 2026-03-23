'use strict';

const { createLogger } = require('../logger');

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
  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
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

      const usMean = new Array(nUs).fill(0);
      const usStd = new Array(nUs).fill(0);
      for (let j = 0; j < nUs; j++) {
        let sum = 0;
        for (let i = 0; i < nSamples; i++) {
          sum += returnsUs[i][j];
        }
        usMean[j] = sum / nSamples;
        let sumSq = 0;
        for (let i = 0; i < nSamples; i++) {
          const diff = returnsUs[i][j] - usMean[j];
          sumSq += diff * diff;
        }
        usStd[j] = Math.sqrt(sumSq / nSamples) + 1e-10;
      }

      const jpMean = new Array(nJp).fill(0);
      const jpStd = new Array(nJp).fill(0);
      for (let j = 0; j < nJp; j++) {
        let sum = 0;
        for (let i = 0; i < nSamples; i++) {
          sum += returnsJp[i][j];
        }
        jpMean[j] = sum / nSamples;
        let sumSq = 0;
        for (let i = 0; i < nSamples; i++) {
          const diff = returnsJp[i][j] - jpMean[j];
          sumSq += diff * diff;
        }
        jpStd[j] = Math.sqrt(sumSq / nSamples) + 1e-10;
      }

      const usReturnSign = returnsUsLatest.map((x, j) => x > 0 ? 1 : x < 0 ? -1 : 0);

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

      const signalMean = signal.reduce((a, b) => a + b, 0) / nJp;
      const signalStd = Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / nJp + 1e-10);

      const signalNormalized = signal.map(s => (s - signalMean) / signalStd);

      logger.debug('Simple lead-lag signal computed', {
        signalMean: signal.reduce((a, b) => a + b, 0) / nJp,
        signalStd: Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / nJp)
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

  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
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

      const usMarketReturn = new Array(nSamples);
      for (let i = 0; i < nSamples; i++) {
        let sum = 0;
        for (let j = 0; j < nUs; j++) {
          sum += returnsUs[i][j];
        }
        usMarketReturn[i] = sum / nUs;
      }

      const usMarketMean = usMarketReturn.reduce((a, b) => a + b, 0) / nSamples;
      let sumSqUs = 0;
      for (let i = 0; i < nSamples; i++) {
        const diff = usMarketReturn[i] - usMarketMean;
        sumSqUs += diff * diff;
      }
      const usMarketStd = Math.sqrt(sumSqUs / nSamples) + 1e-10;

      const signal = new Array(nJp).fill(0);

      const jpMean = new Array(nJp).fill(0);
      const jpStd = new Array(nJp).fill(0);
      for (let j = 0; j < nJp; j++) {
        const sum = returnsJp.reduce((s, row) => s + row[j], 0);
        jpMean[j] = sum / nSamples;
        const sumSq = returnsJp.reduce((s, row) => s + row[j] * row[j], 0);
        jpStd[j] = Math.sqrt(sumSq / nSamples) + 1e-10;
      }

      for (let j = 0; j < nJp; j++) {
        let cov = 0;
        for (let i = 0; i < nSamples; i++) {
          const usZ = (usMarketReturn[i] - usMarketMean) / usMarketStd;
          const jpZ = (returnsJp[i][j] - jpMean[j]) / jpStd[j];
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
