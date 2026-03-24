'use strict';

const {
  transpose,
  matmul,
  dotProduct,
  normalize,
  diag,
  makeDiag,
  correlationMatrixSample,
  ewmaCorrelationMatrix,
  eigenSymmetricTopK,
  ZERO_THRESHOLD
} = require('../math');

const { createLogger } = require('../logger');

const logger = createLogger('SubspacePCA');

/**
 * 部分空間正則化付き PCA クラス
 */
class SubspaceRegularizedPCA {
  /**
   * @param {Object} config - 設定
   * @param {number} config.lambdaReg - 正則化パラメータ
   * @param {number} config.nFactors - 因子数
   * @param {boolean} [config.useEwma=false] - EWMA 相関行列を使用するか
   * @param {number}  [config.ewmaHalflife=30] - EWMA 半減期（日数）
   * @param {boolean} [config.useAdaptiveLambda=false] - 適応的 λ を使用するか
   * @param {number}  [config.lambdaMin=0.5]  - 適応的 λ の下限
   * @param {number}  [config.lambdaMax=0.95] - 適応的 λ の上限
   * @param {number}  [config.volLow=0.08]    - 適応 λ: 低ボラ閾値（年率）
   * @param {number}  [config.volHigh=0.30]   - 適応 λ: 高ボラ閾値（年率）
   */
  constructor(config = {}) {
    this.config = {
      lambdaReg: config.lambdaReg ?? 0.9,
      nFactors: config.nFactors ?? 3,
      useEwma: config.useEwma ?? false,
      ewmaHalflife: config.ewmaHalflife ?? 30,
      useAdaptiveLambda: config.useAdaptiveLambda ?? false,
      lambdaMin: config.lambdaMin ?? 0.5,
      lambdaMax: config.lambdaMax ?? 0.95,
      volLow: config.volLow ?? 0.08,
      volHigh: config.volHigh ?? 0.30
    };

    /** 結合リターン列順と一致させるキー（未指定時は sectorLabels の挿入順、長さが N でないとエラー） */
    this.orderedSectorKeys = config.orderedSectorKeys ?? null;

    this.V0 = null;
    this.D0 = null;
    this.C0 = null;
  }

  /**
   * v3 構築用の列順キー
   * @param {number} nUs
   * @param {number} nJp
   * @param {Object} sectorLabels
   * @returns {string[]}
   */
  resolveOrderedKeys(nUs, nJp, sectorLabels) {
    const N = nUs + nJp;
    if (this.orderedSectorKeys && this.orderedSectorKeys.length === N) {
      return this.orderedSectorKeys;
    }
    const keys = Object.keys(sectorLabels);
    if (keys.length === N) {
      return keys;
    }
    throw new Error(
      `orderedSectorKeys required (length ${N}); got ${this.orderedSectorKeys?.length ?? 'none'} / object keys ${keys.length}`
    );
  }

  /**
   * 事前部分空間の構築
   * @param {number} nUs - 米国セクター数
   * @param {number} nJp - 日本セクター数
   * @param {Object} sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull - 長期相関行列
   * @returns {void}
   */
  buildPriorSpace(nUs, nJp, sectorLabels, CFull) {
    try {
      const N = nUs + nJp;
      const keys = this.resolveOrderedKeys(nUs, nJp, sectorLabels);

      // セクターラベルの順序保証と検証
      logger.debug('Building prior space', { nUs, nJp, keys });

      // 1. グローバルファクター：全銘柄に等しい重み
      let v1 = new Array(N).fill(1);
      v1 = normalize(v1);

      // 2. 国スプレッドファクター：米国 (+) vs 日本 (-)
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
        const label = sectorLabels[key];
        
        if (!label) {
          logger.warn(`No label found for key: ${key}`);
        }
        
        if (label === 'cyclical') {
          v3[i] = 1;
        } else if (label === 'defensive') {
          v3[i] = -1;
        }
        // neutral は 0 のまま
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
      const invSqrtDelta = delta.map(x => 1 / Math.sqrt(Math.abs(x) + ZERO_THRESHOLD));
      const invSqrtMat = makeDiag(invSqrtDelta);
      const C0 = matmul(matmul(invSqrtMat, C0Raw), invSqrtMat);

      // 対角要素を 1 に調整
      for (let i = 0; i < N; i++) {
        C0[i][i] = 1;
      }

      this.V0 = V0;
      this.D0 = D0;
      this.C0 = C0;

      logger.debug('Prior space built successfully', {
        dimensions: { N, nUs, nJp },
        eigenvalues: D0
      });
    } catch (error) {
      logger.error('Failed to build prior space', { error: error.message });
      throw error;
    }
  }

  /**
   * 部分空間正則化 PCA の計算
   *
   * 改善オプション:
   *   - useEwma: true のとき correlationMatrixSample の代わりに ewmaCorrelationMatrix を使用
   *   - useAdaptiveLambda: true のとき realizedVol から λ を自動調整
   *
   * @param {Array<Array<number>>} returns      - リターン行列 (L × N)
   * @param {Object}               sectorLabels - セクターラベル
   * @param {Array<Array<number>>} CFull        - 長期相関行列
   * @param {number}               [realizedVol]- 年率実現ボラティリティ（適応 λ 用）
   * @returns {Object} { VK, eigenvalues, CReg, converged, lambdaUsed }
   */
  computeRegularizedPCA(returns, sectorLabels, CFull, realizedVol = null) {
    try {
      const nUs = Object.keys(sectorLabels).filter(k => k.startsWith('US_')).length;
      const nJp = Object.keys(sectorLabels).filter(k => k.startsWith('JP_')).length;

      if (this.C0 === null) {
        this.buildPriorSpace(nUs, nJp, sectorLabels, CFull);
      }

      // --- 改善 1: EWMA 相関行列 (オプション) ---
      // useEwma=true のとき直近観測に高い重みを与えた相関行列を使用。
      // halflife=30: 今日の重みは 30 日前の 2 倍 (RiskMetrics 標準)。
      const CT = this.config.useEwma
        ? ewmaCorrelationMatrix(returns, this.config.ewmaHalflife)
        : correlationMatrixSample(returns);

      // --- 改善 3: 適応的 λ (オプション) ---
      // 高ボラ局面では λ を小さくしてデータ主導に、
      // 低ボラ局面では λ を大きくして事前知識を強く反映。
      //
      // 数式:
      //   x = clip((σ_t - volLow) / (volHigh - volLow), 0, 1)
      //   λ_t = lambdaMax - x * (lambdaMax - lambdaMin)
      let lambda = this.config.lambdaReg;
      if (this.config.useAdaptiveLambda && realizedVol !== null && Number.isFinite(realizedVol)) {
        const { lambdaMin, lambdaMax, volLow, volHigh } = this.config;
        const x = Math.max(0, Math.min(1, (realizedVol - volLow) / (volHigh - volLow)));
        lambda = lambdaMax - x * (lambdaMax - lambdaMin);
      }

      // 正則化相関行列：C_reg = (1 - λ) * C_t + λ * C0
      const N = CT.length;
      const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0));

      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          CReg[i][j] = (1 - lambda) * CT[i][j] + lambda * this.C0[i][j];
        }
      }

      // 対称行列の固有分解（eigh 相当）
      const { eigenvalues, eigenvectors, converged } = eigenSymmetricTopK(
        CReg,
        this.config.nFactors
      );

      // 固有ベクトルを列として格納
      const VK = transpose(eigenvectors);

      logger.debug('PCA computed successfully', {
        dimensions: N,
        lambda,
        useEwma: this.config.useEwma,
        useAdaptiveLambda: this.config.useAdaptiveLambda,
        topEigenvalue: eigenvalues[0],
        converged
      });

      return { VK, eigenvalues, CReg, converged, lambdaUsed: lambda };
    } catch (error) {
      logger.error('Failed to compute PCA', { error: error.message });
      throw error;
    }
  }

  /**
   * 正則化なし PCA の計算（ベースライン用）
   * @param {Array<Array<number>>} returns - リターン行列
   * @param {number} nFactors - 因子数
   * @returns {Object} { VK: Array, eigenvalues: Array, converged: boolean }
   */
  computePlainPCA(returns, nFactors = 3) {
    try {
      const CT = correlationMatrixSample(returns);
      const { eigenvalues, eigenvectors, converged } = eigenSymmetricTopK(CT, nFactors);
      const VK = transpose(eigenvectors);

      logger.debug('Plain PCA computed successfully', {
        topEigenvalue: eigenvalues[0],
        converged
      });

      return { VK, eigenvalues, converged };
    } catch (error) {
      logger.error('Failed to compute plain PCA', { error: error.message });
      throw error;
    }
  }
}

module.exports = {
  SubspaceRegularizedPCA
};
