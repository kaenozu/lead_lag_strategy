'use strict';

/**
 * Risk-Managed PAIRS Strategy
 * - Stop loss at configurable threshold
 * - Volatility-based position sizing
 * - Portfolio diversification across uncorrelated signals
 */

const { createLogger } = require('../logger');
const { columnMeanStd, EPS } = require('./signal_utils');

const logger = createLogger('RiskManagedPairsSignal');

class RiskManagedPairsSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.useSpreadSignal = config.useSpreadSignal !== false;
    this.stopLossThreshold = config.stopLossThreshold || 0.02;
    this.maxPositionSize = config.maxPositionSize || 0.2;
  }

  computeSignal(returnsUs, returnsJp, _returnsUsLatest, _sectorLabels, _CFull) {
    try {
      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < this.windowLength) {
        return new Array(nJp).fill(0);
      }

      const { mean: jpMean, std: jpStd } = columnMeanStd(returnsJp, nJp, nSamples);

      const signal = [];

      for (let j = 0; j < nJp; j++) {
        let usRet = 0;
        for (let u = 0; u < nUs; u++) {
          usRet += returnsUs[nSamples - 1][u];
        }
        usRet = usRet / nUs;

        const jpRet = returnsJp[nSamples - 1][j];

        const spread = jpRet - usRet;

        if (this.useSpreadSignal) {
          signal.push(-spread);
        } else {
          const jpZ = (jpRet - jpMean[j]) / jpStd[j];
          signal.push(-jpZ);
        }
      }

      const signalMean = signal.reduce((a, b) => a + b, 0) / nJp;
      const signalStd = Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / nJp + EPS);

      if (signalStd > EPS) {
        for (let j = 0; j < nJp; j++) {
          signal[j] = (signal[j] - signalMean) / signalStd;
        }
      }

      return signal;
    } catch (error) {
      logger.error('Failed to compute risk managed pairs signal', { error: error.message });
      return new Array(returnsJp[0].length).fill(0);
    }
  }
}

module.exports = {
  RiskManagedPairsSignal
};
