'use strict';

/**
 * Pairs Strategy - spread mean reversion
 * When JP outperforms US, bet on mean reversion (JP will underperform)
 * When JP underperforms US, bet on mean reversion (JP will outperform)
 */

const { createLogger } = require('../logger');

const logger = createLogger('PairsSignal');

class PairsSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.useSpreadSignal = config.useSpreadSignal !== false;
  }

  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
    try {
      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < this.windowLength) {
        return new Array(nJp).fill(0);
      }

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

      const signal = [];

      const usMeanMarket = usMean.reduce((a, b) => a + b, 0) / nUs;
      const usStdMarket = usStd.reduce((a, b) => a + b, 0) / nUs;

      for (let j = 0; j < nJp; j++) {
        let usRet = 0;
        for (let u = 0; u < nUs; u++) {
          usRet += returnsUs[nSamples - 1][u];
        }
        usRet = usRet / nUs;

        const jpRet = returnsJp[nSamples - 1][j];

        const spread = jpRet - usRet;

        const usZ = (usRet - usMeanMarket) / usStdMarket;
        const jpZ = (jpRet - jpMean[j]) / jpStd[j];

        if (this.useSpreadSignal) {
          signal.push(-spread);
        } else {
          signal.push(-jpZ);
        }
      }

      const signalMean = signal.reduce((a, b) => a + b, 0) / nJp;
      const signalStd = Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / nJp + 1e-10);

      if (signalStd > 1e-10) {
        for (let j = 0; j < nJp; j++) {
          signal[j] = (signal[j] - signalMean) / signalStd;
        }
      }

      logger.debug('PairsSignal computed', {
        signalMean,
        signalStd
      });

      return signal;
    } catch (error) {
      logger.error('Failed to compute pairs signal', { error: error.message });
      return new Array(returnsJp[0].length).fill(0);
    }
  }
}

module.exports = {
  PairsSignal
};
