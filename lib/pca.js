/**
 * 部分空間正則化付きPCA
 * Subspace Regularized PCA
 */

'use strict';

const {
  transpose,
  matmul,
  dotProduct,
  normalize,
  diag,
  makeDiag,
  eigenDecomposition,
  correlationMatrix
} = require('./math');

const { createLogger } = require('./logger');

/**
 * 部分空間正則化付きPCAクラス
 */
class SubspaceRegularizedPCA {
  /**
   * @param {Object} config - 設定
   * @param {number} config.lambdaReg - 正則化パラメータ
   * @param {number} config.nFactors - 因子数
   */
  constructor(config = {}) {
    this.config = {
      lambdaReg: config.lambdaReg ?? 0.9,
      nFactors: config.nFactors ?? 3
    };
    
    this.V0 = null;
    this.D0 = null;
    this.C0 = null;
    
    this.logger = createLogger('PCA');
  }

  /**
   * 事前部分空間の構築
   * @param {number} nUs - 米国セクター数
   * @param {number} nJp - 日本セクター数
   * @param {Object} sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull - 長期相関行列
   */
  buildPriorSpace(nUs, nJp, sectorLabels, CFull) {
    try {
      const N = nUs + nJp;
      const keys = Object.keys(sectorLabels);

      // 1. グローバルファクター：全銘柄に等しい重み
      let v1 = new Array(N).fill(1);
      v1 = normalize(v1);

      // 2. 国スプレッドファクター：米国を正、日本を負
      let v2 = new Array(N).fill(0);
      for (let i = 0; i < nUs; i++) v2[i] = 1;
      for (let i = nUs; i < N; i++) v2[i] = -1;
      // v1 に直交化
      const proj2 = dotProduct(v2, v1);
      v2 = v2.map((x, i) => x - proj2 * v1[i]);
      v2 = normalize(v2);

      // 3. シクリカル・ディフェンシブファクター
      let v3 = new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        const key = keys[i];
        if (sectorLabels[key] === 'cyclical') {
          v3[i] = 1;
        } else if (sectorLabels[key] === 'defensive') {
          v3[i] = -1;
        }
      }
      // v1, v2 に直交化
      const proj3_1 = dotProduct(v3, v1);
      const proj3_2 = dotProduct(v3, v2);
      v3 = v3.map((x, i) => x - proj3_1 * v1[i] - proj3_2 * v2[i]);
      v3 = normalize(v3);

      // V0 = [v1, v2, v3] (N x 3 行列)
      const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);

      // 事前方向の固有値を推定
      const CFullV0 = matmul(CFull, V0);
      const V0TCFullV0 = matmul(transpose(V0), CFullV0);
      const D0 = diag(V0TCFullV0);

      // ターゲット行列 C0_raw = V0 * diag(D0) * V0^T
      const D0Mat = makeDiag(D0);
      const V0D0 = matmul(V0, D0Mat);
      const C0Raw = matmul(V0D0, transpose(V0));

      // 相関行列に変換（対角要素で正規化）
      const delta = diag(C0Raw);
      const invSqrtDelta = delta.map(x => 1 / Math.sqrt(Math.abs(x) + 1e-10));
      const invSqrtMat = makeDiag(invSqrtDelta);
      let C0 = matmul(matmul(invSqrtMat, C0Raw), invSqrtMat);

      // 対角要素を 1 に調整
      for (let i = 0; i < N; i++) {
        C0[i][i] = 1;
      }

      this.V0 = V0;
      this.D0 = D0;
      this.C0 = C0;

      this.logger.debug('Prior space built successfully', {
        dimensions: { N, nUs, nJp },
        eigenvalues: D0
      });
    } catch (error) {
      this.logger.error('Failed to build prior space', { error: error.message });
      throw error;
    }
  }

  /**
   * 部分空間正則化PCAの計算
   * @param {Array<Array<number>>} returns - リターン行列
   * @param {Object} sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull - 長期相関行列
   * @returns {Object} { VK: Array, eigenvalues: Array, CReg: Array }
   */
  computeRegularizedPCA(returns, sectorLabels, CFull) {
    return this.logger.profileSync('computeRegularizedPCA', () => {
      try {
        const nUs = Object.keys(sectorLabels).filter(k => k.startsWith('US_')).length;
        const nJp = Object.keys(sectorLabels).filter(k => k.startsWith('JP_')).length;

        if (this.C0 === null) {
          this.buildPriorSpace(nUs, nJp, sectorLabels, CFull);
        }

        // 相関行列の計算
        const CT = correlationMatrix(returns);

        // 正則化相関行列: C_reg = (1 - λ) * C_t + λ * C0
        const N = CT.length;
        const lambda = this.config.lambdaReg;
        const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0));
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            CReg[i][j] = (1 - lambda) * CT[i][j] + lambda * this.C0[i][j];
          }
        }

        // 固有分解
        const { eigenvalues, eigenvectors } = eigenDecomposition(CReg, this.config.nFactors);

        // 固有ベクトルを列として格納
        const VK = transpose(eigenvectors);

        this.logger.debug('PCA computed successfully', {
          dimensions: N,
          lambda,
          topEigenvalue: eigenvalues[0]
        });

        return { VK, eigenvalues, CReg };
      } catch (error) {
        this.logger.error('Failed to compute PCA', { error: error.message });
        throw error;
      }
    });
  }

  /**
   * 正則化なしPCAの計算（ベースライン用）
   * @param {Array<Array<number>>} returns - リターン行列
   * @param {number} nFactors - 因子数
   * @returns {Object} { VK: Array, eigenvalues: Array }
   */
  computePlainPCA(returns, nFactors = 3) {
    return this.logger.profileSync('computePlainPCA', () => {
      try {
        const CT = correlationMatrix(returns);
        const { eigenvalues, eigenvectors } = eigenDecomposition(CT, nFactors);
        const VK = transpose(eigenvectors);

        this.logger.debug('Plain PCA computed successfully', {
          topEigenvalue: eigenvalues[0]
        });

        return { VK, eigenvalues };
      } catch (error) {
        this.logger.error('Failed to compute plain PCA', { error: error.message });
        throw error;
      }
    });
  }
}

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
    this.logger = createLogger('LeadLagSignal');
  }

  /**
   * リードラグシグナルの計算
   * @param {Array<Array<number>>} returnsUs - 米国リターン（ウィンドウ分）
   * @param {Array<Array<number>>} returnsJp - 日本リターン（ウィンドウ分）
   * @param {Array<number>} returnsUsLatest - 米国最新リターン
   * @param {Object} sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull - 長期相関行列
   * @returns {Array<number>} 日本セクターの予測シグナル
   */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
    return this.logger.profileSync('computeSignal', () => {
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

        // 部分空間正則化PCA
        const { VK } = this.pca.computeRegularizedPCA(returnsStd, sectorLabels, CFull);

        // 米国・日本に分割
        const VUs = VK.slice(0, nUs);
        const VJp = VK.slice(nUs);

        // 米国最新リターンの標準化
        const zUsLatest = returnsUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);

        // ファクタースコア: f_t = V_US^T * z_us_latest
        const fT = VUs.map(v => dotProduct(v, zUsLatest));

        // 日本側予測シグナル: signal = V_JP * f_t
        const signal = VJp.map(v => dotProduct(v, fT));

        this.logger.debug('Signal computed successfully', {
          signalMean: signal.reduce((a, b) => a + b, 0) / signal.length,
          signalStd: Math.sqrt(signal.reduce((sq, x) => sq + x * x, 0) / signal.length)
        });

        return signal;
      } catch (error) {
        this.logger.error('Failed to compute signal', { error: error.message });
        throw error;
      }
    });
  }
}

module.exports = {
  SubspaceRegularizedPCA,
  LeadLagSignal
};
