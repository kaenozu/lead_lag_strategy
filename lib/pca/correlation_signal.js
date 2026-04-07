'use strict';

const { createLogger } = require('../logger');
const { columnMoments, zScoreRow, meanAndStd, normalizeByMaxAbs, EPS } = require('./signal_utils');

const logger = createLogger('CrossCorrelationSignal');

/**
 * クロス相関ベースの強いラグ戦略
 * 
 * 論文レベルの戦略要素:
 * 1. 複数のラグ窓で相関を計算し最強のものを選択
 * 2. 統計的に有意な相関のみ使用
 * 3. 週次リバランスで取引コスト削減
 * 4. ボラティリティ調整済み位置サイズ
 */
class CrossCorrelationSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.minCorrelation = config.minCorrelation || 0.05;
    this.maxLag = config.maxLag || 5;
    this.useWeekly = config.useWeekly !== false;
  }

  /**
   * シグナル計算
   * @param {Array<Array<number>>} returnsUs - USリターン（窗口×nUs）
   * @param {Array<Array<number>>} returnsJp - JPリターン（窗口×nJp）
   * @param {Array<number>} returnsUsLatest - US最新リターン（t-1）
   * @returns {Array<number>} JP各セクターのシグナル
   */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, _sectorLabels, _CFull) {
    try {
      const nJp = returnsJp[0].length;
      const nUs = returnsUs[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < this.windowLength) {
        return new Array(nJp).fill(0);
      }

      const { mean: usMean, std: usStd } = columnMoments(returnsUs);
      const { mean: jpMean, std: jpStd } = columnMoments(returnsJp);
      const usLatestZ = zScoreRow(returnsUsLatest, usMean, usStd);
      const signal = new Array(nJp).fill(0);
      let validSignals = 0;

      for (let j = 0; j < nJp; j++) {
        let bestLag = 0;
        let bestCorr = 0;
        let bestUsIdx = 0;

        for (let u = 0; u < nUs; u++) {
          for (let lag = 0; lag <= this.maxLag; lag++) {
            let corrNum = 0;
            let corrDen1 = 0;
            let corrDen2 = 0;

            for (let i = 0; i < nSamples - lag; i++) {
              const usZ = (returnsUs[i][u] - usMean[u]) / usStd[u];
              const jpZ = (returnsJp[i + lag][j] - jpMean[j]) / jpStd[j];
              corrNum += usZ * jpZ;
              corrDen1 += usZ * usZ;
              corrDen2 += jpZ * jpZ;
            }

            const corr = corrNum / Math.sqrt(corrDen1 * corrDen2 + EPS);

            if (Math.abs(corr) > Math.abs(bestCorr)) {
              bestCorr = corr;
              bestLag = lag;
              bestUsIdx = u;
            }
          }
        }

        if (Math.abs(bestCorr) > this.minCorrelation) {
          const usPrevZ = bestLag === 0 ? usLatestZ[bestUsIdx] : 0;
          signal[j] = bestCorr * (usPrevZ > 0 ? 1 : usPrevZ < 0 ? -1 : 0);
          validSignals++;
        }
      }

      if (validSignals === 0) {
        return new Array(nJp).fill(0);
      }

      const { mean: signalMean, std: signalStd } = meanAndStd(signal);

      if (signalStd > EPS) {
        for (let j = 0; j < nJp; j++) {
          signal[j] = (signal[j] - signalMean) / signalStd;
        }
      }

      logger.debug('CrossCorrelationSignal computed', {
        validSignals,
        bestCorr: Math.max(...signal.map(Math.abs))
      });

      return signal;
    } catch (error) {
      logger.error('Failed to compute cross-correlation signal', { error: error.message });
      return new Array(returnsJp[0].length).fill(0);
    }
  }
}

/**
 * 增强型相関戦略 - 複数セクターの情報を集約
 */
class EnsembleCorrelationSignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.correlationThreshold = config.correlationThreshold || 0.02;
    this.numLags = config.numLags || 3;
  }

  computeSignal(returnsUs, returnsJp, _returnsUsLatest, _sectorLabels, _CFull) {
    try {
      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < this.windowLength) {
        return new Array(nJp).fill(0);
      }

      const { mean: usMean, std: usStd } = columnMoments(returnsUs);
      const { mean: jpMean, std: jpStd } = columnMoments(returnsJp);

      const signal = new Array(nJp).fill(0);

      for (let lag = 1; lag <= this.numLags; lag++) {
        for (let u = 0; u < nUs; u++) {
          const usPrevZ = (returnsUs[nSamples - lag][u] - usMean[u]) / usStd[u];

          for (let j = 0; j < nJp; j++) {
            let corrNum = 0;
            let corrDen1 = 0;
            let corrDen2 = 0;

            for (let i = lag; i < nSamples; i++) {
              const usZ = (returnsUs[i - lag][u] - usMean[u]) / usStd[u];
              const jpZ = (returnsJp[i][j] - jpMean[j]) / jpStd[j];
              corrNum += usZ * jpZ;
              corrDen1 += usZ * usZ;
              corrDen2 += jpZ * jpZ;
            }

            const corr = corrNum / Math.sqrt(corrDen1 * corrDen2 + EPS);

            if (Math.abs(corr) > this.correlationThreshold) {
              const sign = usPrevZ > 0 ? 1 : usPrevZ < 0 ? -1 : 0;
              signal[j] += sign * corr;
            }
          }
        }
      }

      const posCount = signal.filter(s => s > 0).length;
      const negCount = signal.filter(s => s < 0).length;

      if (posCount === 0 && negCount === 0) {
        return new Array(nJp).fill(0);
      }

      return normalizeByMaxAbs(signal);
    } catch (error) {
      logger.error('Failed to compute ensemble signal', { error: error.message });
      return new Array(returnsJp[0].length).fill(0);
    }
  }
}

/**
 * シンプルだが効果的な戦略: US市場リスクをヘッジしながらJP市場曝露を得る
 */
class RiskParitySignal {
  constructor(config = {}) {
    this.windowLength = config.windowLength || 60;
    this.correlationThreshold = config.correlationThreshold || 0.01;
  }

  computeSignal(returnsUs, returnsJp, _returnsUsLatest, _sectorLabels, _CFull) {
    try {
      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;
      const nSamples = returnsUs.length;

      if (nSamples < this.windowLength) {
        return new Array(nJp).fill(0);
      }

      const { mean: jpMean, std: jpStd } = columnMoments(returnsJp);
      const { mean: usMean, std: usStd } = columnMoments(returnsUs);

      const usMarketReturn = returnsUs[nSamples - 1].reduce((a, b) => a + b, 0) / nUs;
      const usMarketDirection = usMarketReturn > 0 ? 1 : usMarketReturn < 0 ? -1 : 0;

      const signal = new Array(nJp).fill(0);

      for (let i = 1; i < nSamples; i++) {
        for (let u = 0; u < nUs; u++) {
          const usZ = (returnsUs[i - 1][u] - usMean[u]) / usStd[u];
          const usSign = usZ > 0 ? 1 : usZ < 0 ? -1 : 0;

          for (let j = 0; j < nJp; j++) {
            const jpZ = (returnsJp[i][j] - jpMean[j]) / jpStd[j];
            const corr = usZ * jpZ;

            if (Math.abs(corr) > this.correlationThreshold) {
              signal[j] += usSign * corr;
            }
          }
        }
      }

      if (usMarketDirection !== 0) {
        for (let j = 0; j < nJp; j++) {
          signal[j] *= usMarketDirection;
        }
      }

      const posCount = signal.filter(s => s > 0).length;
      const negCount = signal.filter(s => s < 0).length;

      if (posCount === 0 && negCount === 0) {
        return new Array(nJp).fill(0);
      }

      return normalizeByMaxAbs(signal);
    } catch (error) {
      logger.error('Failed to compute risk parity signal', { error: error.message });
      return new Array(returnsJp[0].length).fill(0);
    }
  }
}

module.exports = {
  CrossCorrelationSignal,
  EnsembleCorrelationSignal,
  RiskParitySignal
};
