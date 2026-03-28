'use strict';

/**
 * Pairs Strategy - spread mean reversion
 * When JP outperforms US, bet on mean reversion (JP will underperform)
 * When JP underperforms US, bet on mean reversion (JP will outperform)
 */

const { createLogger } = require('../logger');
const { columnMeanStd, normalizeStd, EPS } = require('./signal_utils');

const logger = createLogger('PairsSignal');

class PairsSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.useSpreadSignal = config.useSpreadSignal !== false;
  }

  computeSignal(returnsUs, returnsJp, _returnsUsLatest, _sectorLabels, _CFull) {
    try {
      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < this.windowLength) {
        return new Array(nJp).fill(0);
      }

      const { mean: jpMean, std: jpStd } = columnMeanStd(returnsJp);

      const signal = [];

      for (let j = 0; j < nJp; j++) {
        let usRet = 0;
        for (let u = 0; u < nUs; u++) {
          usRet += returnsUs[nSamples - 1][u];
        }
        usRet = usRet / nUs;

        const jpRet = returnsJp[nSamples - 1][j];

        const spread = jpRet - usRet;

        const jpZ = (jpRet - jpMean[j]) / jpStd[j];

        if (this.useSpreadSignal) {
          signal.push(-spread);
        } else {
          signal.push(-jpZ);
        }
      }

      const signalMean = signal.reduce((a, b) => a + b, 0) / nJp;
      const signalStd = Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / nJp + EPS);
      const signalNorm = normalizeStd(signal);

      logger.debug('PairsSignal computed', {
        signalMean,
        signalStd
      });

      return signalNorm;
    } catch (error) {
      logger.error('Failed to compute pairs signal', { error: error.message });
      return new Array(returnsJp[0].length).fill(0);
    }
  }
}

module.exports = {
  PairsSignal
};
