'use strict';

const { createLogger } = require('../logger');

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
   * @param {Array<number>} returnsUsLatest - 米国 CC リターン（推定窓の直後に観測可能なショック。日付整列済み行では当該 JP 行と対になる米国）
   * @param {Object} sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull - 長期相関行列
   * @returns {Array<number>} 日本セクターの予測シグナル
   */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
    try {
      // 入力検証
      if (!returnsUs || !returnsJp || !returnsUsLatest) {
        throw new Error('Invalid input: returns data is missing');
      }
      if (returnsUs.length === 0 || returnsJp.length === 0) {
        throw new Error('Invalid input: returns data is empty');
      }

      const nSamples = returnsUs.length;
      const nUs = returnsUs[0].length;
      const nJp = returnsJp[0].length;

      // 結合リターン行列
      const returnsCombined = returnsUs.map((row, i) => [...row, ...returnsJp[i]]);

      // 標準化
      const N = nUs + nJp;
      const mu = new Array(N).fill(0);
      const sigma = new Array(N).fill(0);

      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let i = 0; i < nSamples; i++) {
          sum += returnsCombined[i][j];
        }
        mu[j] = sum / nSamples;

        let sumSq = 0;
        for (let i = 0; i < nSamples; i++) {
          const diff = returnsCombined[i][j] - mu[j];
          sumSq += diff * diff;
        }
        sigma[j] = Math.sqrt(sumSq / nSamples) + 1e-10;
      }

      const returnsStd = returnsCombined.map(row =>
        row.map((x, j) => (x - mu[j]) / sigma[j])
      );

      // 部分空間正則化 PCA
      const { VK } = this.pca.computeRegularizedPCA(returnsStd, sectorLabels, CFull);

      // VK は transpose(固有ベクトル行) なので N 行 × nFac 列
      const nFac = VK[0].length;

      // 米国最新リターンの標準化 (US-only statisticsを使用)
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

      // 日本側予測シグナル：signal[i] = sum_k VK[nUs+i][k] * fT[k]
      const signal = [];
      for (let i = 0; i < nJp; i++) {
        let s = 0;
        for (let k = 0; k < nFac; k++) {
          s += VK[nUs + i][k] * fT[k];
        }
        signal.push(s);
      }

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
}

module.exports = {
  LeadLagSignal
};
