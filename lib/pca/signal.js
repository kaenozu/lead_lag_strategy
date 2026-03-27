'use strict';

const { createLogger } = require('../logger');
const { ZERO_THRESHOLD } = require('../math');

const logger = createLogger('LeadLagSignal');

const { SubspaceRegularizedPCA } = require('./subspace');

/**
 * リードラグシグナル生成クラス
 */
class LeadLagSignal {
  /**
   * @param {Object} config - 設定
   */
  constructor(config = {}) {
    this.config = config;
    this.pca = new SubspaceRegularizedPCA(config);
  }

  /**
   * リードラグシグナルの計算
   * @param {Array<Array<number>>} returnsUs - 米国リターン（ウィンドウ分）
   * @param {Array<Array<number>>} returnsJp - 日本リターン（ウィンドウ分）
   * @param {Array<number>} returnsUsLatest - 米国 CC リターン（推定窓の直後に観測可能なショック）
   * @param {Object} sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull - 長期相関行列
   * @returns {Array<number>} 日本セクターの予測シグナル
   */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
    try {
      // 入力検証
      this._validateInputs(returnsUs, returnsJp, returnsUsLatest);

      // 標準化
      const { returnsStd, mu, sigma, nUs } = this._standardizeReturns(returnsUs, returnsJp);

      // 部分空間正則化 PCA
      const { VK } = this.pca.computeRegularizedPCA(returnsStd, sectorLabels, CFull);
      const nFac = VK[0].length;

      // ファクタースコア計算
      const fT = this._computeFactorScores(VK, returnsUsLatest, mu, sigma, nUs, nFac);

      // 日本側予測シグナル復元
      const signal = this._reconstructJapanSignal(VK, fT, nUs, returnsJp[0].length);

      logger.debug('Signal computed successfully', {
        signalMean: signal.reduce((a, b) => a + b, 0) / signal.length,
        signalStd: Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / signal.length)
      });

      return signal;
    } catch (error) {
      logger.error('Failed to compute signal', { error: error.message });
      throw error;
    }
  }

  /**
   * 入力検証
   * @private
   */
  _validateInputs(returnsUs, returnsJp, returnsUsLatest) {
    if (!returnsUs || !returnsJp || !returnsUsLatest) {
      throw new Error('Invalid input: returns data is missing');
    }
    if (returnsUs.length === 0 || returnsJp.length === 0) {
      throw new Error('Invalid input: returns data is empty');
    }
    if (returnsUsLatest.length === 0) {
      throw new Error('Invalid input: returnsUsLatest is empty');
    }
  }

  /**
   * リターンの標準化
   * @private
   */
  _standardizeReturns(returnsUs, returnsJp) {
    const nSamples = returnsUs.length;
    const nUs = returnsUs[0].length;
    const nJp = returnsJp[0].length;

    // 結合リターン行列
    const returnsCombined = returnsUs.map((row, i) => [...row, ...returnsJp[i]]);

    // 平均と標準偏差の計算
    const N = nUs + nJp;
    const mu = new Array(N).fill(0);
    const sigma = new Array(N).fill(0);

    for (let j = 0; j < N; j++) {
      // 平均
      let sum = 0;
      for (let i = 0; i < nSamples; i++) {
        sum += returnsCombined[i][j];
      }
      mu[j] = sum / nSamples;

      // 標準偏差
      let sumSq = 0;
      for (let i = 0; i < nSamples; i++) {
        const diff = returnsCombined[i][j] - mu[j];
        sumSq += diff * diff;
      }
      sigma[j] = Math.sqrt(sumSq / nSamples) + ZERO_THRESHOLD;
    }

    // 標準化
    const returnsStd = returnsCombined.map(row =>
      row.map((x, j) => (x - mu[j]) / sigma[j])
    );

    return { returnsStd, mu, sigma, nUs };
  }

  /**
   * ファクタースコアの計算
   * @private
   */
  _computeFactorScores(VK, returnsUsLatest, mu, sigma, nUs, nFac) {
    // 米国最新リターンの標準化
    const muUs = mu.slice(0, nUs);
    const sigmaUs = sigma.slice(0, nUs);
    const zUsLatest = returnsUsLatest.map((x, j) => (x - muUs[j]) / sigmaUs[j]);

    // ファクタースコア：f[k] = sum_{j<nUs} VK[j][k] * z_us[j]
    const fT = [];
    for (let k = 0; k < nFac; k++) {
      let s = 0;
      for (let j = 0; j < nUs; j++) {
        s += VK[j][k] * zUsLatest[j];
      }
      fT.push(s);
    }
    return fT;
  }

  /**
   * 日本側シグナルの復元
   * @private
   */
  _reconstructJapanSignal(VK, fT, nUs, nJp) {
    const signal = [];
    for (let i = 0; i < nJp; i++) {
      let s = 0;
      for (let k = 0; k < fT.length; k++) {
        s += VK[nUs + i][k] * fT[k];
      }
      signal.push(s);
    }
    return signal;
  }
}

module.exports = {
  LeadLagSignal
};
