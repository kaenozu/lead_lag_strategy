'use strict';

const { createLogger } = require('../logger');
const { matrixMeanStd, normalizeByMaxAbs } = require('./signal_utils');

const logger = createLogger('DirectionalLeadLagSignal');

/**
 * 方向性リードラグシグナル
 * US市場の向きを使ってJP市場を取引
 * 
 * ロジック: US[t-1] > 0 なら JP[t] をロング、US[t-1] < 0 なら JP[t] をショート
 */
class DirectionalLeadLagSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
  }

  /**
   * シグナル計算
   * @param {Array<Array<number>>} returnsUs - USリターン（窗口×nUs）
   * @param {Array<Array<number>>} returnsJp - JPリターン（窗口×nJp）
   * @param {Array<number>} returnsUsLatest - US最新リターン（t-1）
   * @returns {Array<number>} JP各セクターのシグナル（全て同符号）
   */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, _sectorLabels, _CFull) {
    try {
      if (!returnsUs || !returnsJp || !returnsUsLatest) {
        throw new Error('Invalid input: returns data is missing');
      }

      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < 10) {
        throw new Error('Insufficient data for signal computation');
      }

      const usMarketReturn = returnsUsLatest.reduce((a, b) => a + b, 0) / returnsUsLatest.length;
      const direction = usMarketReturn > 0 ? 1 : usMarketReturn < 0 ? -1 : 0;

      const signal = new Array(nJp).fill(direction);

      logger.debug('Directional signal computed', {
        usMarketReturn,
        direction
      });

      return signal;
    } catch (error) {
      logger.error('Failed to compute directional signal', { error: error.message });
      throw error;
    }
  }
}

/**
 * セクター別方向性シグナル
 * US individual sectors -> JP individual sectors
 */
class SectorDirectionalSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.correlationThreshold = config.correlationThreshold || 0.02;
  }

  computeSignal(returnsUs, returnsJp, returnsUsLatest, _sectorLabels, _CFull) {
    try {
      if (!returnsUs || !returnsJp || !returnsUsLatest) {
        throw new Error('Invalid input: returns data is missing');
      }

      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < 20) {
        throw new Error('Insufficient data for signal computation');
      }

      const { mean: usMean, std: usStd } = matrixMeanStd(returnsUs);
      const { mean: jpMean, std: jpStd } = matrixMeanStd(returnsJp);

      const signal = new Array(nJp).fill(0);

      for (let i = 0; i < nSamples - 1; i++) {
        for (let u = 0; u < nUs; u++) {
          for (let j = 0; j < nJp; j++) {
            const usPrevZ = (returnsUs[i][u] - usMean[u]) / usStd[u];
            const jpCurrZ = (returnsJp[i + 1][j] - jpMean[j]) / jpStd[j];
            const corr = usPrevZ * jpCurrZ;

            if (Math.abs(corr) > this.correlationThreshold) {
              const usSign = returnsUs[i][u] > 0 ? 1 : returnsUs[i][u] < 0 ? -1 : 0;
              signal[j] += usSign * corr;
            }
          }
        }
      }

      const posCount = signal.filter(s => s > 0).length;
      const negCount = signal.filter(s => s < 0).length;
      
      if (posCount === 0 && negCount === 0) {
        return signal.map(() => 0);
      }

      return normalizeByMaxAbs(signal);
    } catch (error) {
      logger.error('Failed to compute sector directional signal', { error: error.message });
      throw error;
    }
  }
}

module.exports = {
  DirectionalLeadLagSignal,
  SectorDirectionalSignal
};
