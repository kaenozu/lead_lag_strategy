/**
 * 部分空間正則化付き PCA を用いた日米業種リードラグ投資戦略
 * Subspace Regularized PCA for Lead-Lag Investment Strategy
 *
 * Reference: 中川慧 et al. "部分空間正則化付き主成分分析を用いた日米業種リードラグ投資戦略"
 */

const { writeFileSync, existsSync, mkdirSync } = require('fs');
const path = require('path');

// ============================================================================
// 定数
// ============================================================================

const DOUBLE_SORT_QUANTILES = {
  low: 0.33,
  high: 0.67
};

// ============================================================================
// 設定
// ============================================================================

const CONFIG = {
  windowLength: 60,      // 推定ウィンドウ長 L
  nFactors: 3,           // 因子数 K
  lambdaReg: 0.9,        // 正則化パラメータ λ
  quantile: 0.3,         // 分位点 q
  warmupPeriod: 60      // ウォームアップ期間
};

// 米国セクター ETF (Select Sector SPDR)
const US_ETF_TICKERS = {
  'XLB': 'Materials',
  'XLC': 'Communication Services',
  'XLE': 'Energy',
  'XLF': 'Financials',
  'XLI': 'Industrials',
  'XLK': 'Information Technology',
  'XLP': 'Consumer Staples',
  'XLRE': 'Real Estate',
  'XLU': 'Utilities',
  'XLV': 'Health Care',
  'XLY': 'Consumer Discretionary'
};

// 日本セクター ETF (TOPIX-17 業種別)
const JP_ETF_TICKERS = {
  '1617.T': 'Food',
  '1618.T': 'Energy & Materials',
  '1619.T': 'Construction & Materials',
  '1620.T': 'Materials & Chemicals',
  '1621.T': 'Pharmaceuticals',
  '1622.T': 'Automobiles & Parts',
  '1623.T': 'Steel & Nonferrous Metals',
  '1624.T': 'Machinery',
  '1625.T': 'Electronics & Precision Instruments',
  '1626.T': 'IT & Services',
  '1627.T': 'Electric Power & Gas',
  '1628.T': 'Transportation & Logistics',
  '1629.T': 'Wholesale Trade',
  '1630.T': 'Retail Trade',
  '1631.T': 'Banks',
  '1632.T': 'Securities & Commodities',
  '1633.T': 'Insurance'
};

// セクターラベル（シクリカル/ディフェンシブ）
const SECTOR_LABELS = {
  // 米国
  'US_XLB': 'cyclical',
  'US_XLE': 'cyclical',
  'US_XLF': 'cyclical',
  'US_XLRE': 'cyclical',
  'US_XLK': 'defensive',
  'US_XLP': 'defensive',
  'US_XLU': 'defensive',
  'US_XLV': 'defensive',
  'US_XLI': 'neutral',
  'US_XLC': 'neutral',
  'US_XLY': 'neutral',
  // 日本
  'JP_1618.T': 'cyclical',
  'JP_1625.T': 'cyclical',
  'JP_1629.T': 'cyclical',
  'JP_1631.T': 'cyclical',
  'JP_1617.T': 'defensive',
  'JP_1621.T': 'defensive',
  'JP_1627.T': 'defensive',
  'JP_1630.T': 'defensive',
  'JP_1619.T': 'neutral',
  'JP_1620.T': 'neutral',
  'JP_1622.T': 'neutral',
  'JP_1623.T': 'neutral',
  'JP_1624.T': 'neutral',
  'JP_1626.T': 'neutral',
  'JP_1628.T': 'neutral',
  'JP_1632.T': 'neutral',
  'JP_1633.T': 'neutral'
};

// ============================================================================
// 線形代数ユーティリティ
// ============================================================================

/**
 * 行列の転置
 */
function transpose(matrix) {
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

/**
 * 行列の積
 */
function matmul(A, B) {
  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;
    
  const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));
    
  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      for (let k = 0; k < colsA; k++) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }
    
  return result;
}

/**
 * ベクトルの内積
 */
function dotProduct(a, b) {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * ベクトルのノルム
 */
function norm(v) {
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

/**
 * ベクトルの正規化
 */
function normalize(v) {
  const n = norm(v);
  return v.map(x => x / n);
}

/**
 * 行列の対角要素を取得
 */
function diag(matrix) {
  return matrix.map((row, i) => row[i]);
}

/**
 * 対角行列の作成
 */
function makeDiag(v) {
  const n = v.length;
  const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    result[i][i] = v[i];
  }
  return result;
}

/**
 * 行列の固有分解（対称行列用 - べき乗法による近似）
 */
function eigenDecposition(matrix, k = 3) {
  const n = matrix.length;
  const eigenvalues = [];
  const eigenvectors = [];
    
  const A = matrix.map(row => [...row]);
    
  for (let e = 0; e < k; e++) {
    // べき乗法: 決定論的な初期化（列eの値を使用、ゼロの場合は単位ベクトル）
    let v = new Array(n).fill(0).map((_, i) => matrix[i][e] || 0);
    const vNorm = norm(v);
    if (vNorm < 1e-10) {
      // フォールバック: 対角要素ベースの初期化
      v = new Array(n).fill(0).map((_, i) => (i === e % n) ? 1 : 0);
    }
    v = normalize(v);
        
    for (let iter = 0; iter < 1000; iter++) {
      const vNew = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          vNew[i] += A[i][j] * v[j];
        }
      }
            
      const newNorm = norm(vNew);
      if (newNorm < 1e-10) break;
            
      v = vNew.map(x => x / newNorm);
    }
        
    // 固有値の計算
    const Av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        Av[i] += A[i][j] * v[j];
      }
    }
    const lambda = dotProduct(v, Av);
        
    eigenvalues.push(lambda);
    eigenvectors.push(v);
        
    // 行列の deflate
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i][j] -= lambda * v[i] * v[j];
      }
    }
  }
    
  return { eigenvalues, eigenvectors };
}

/**
 * 相関行列の計算
 */
function correlationMatrix(data) {
  const n = data.length;      // 行数
  const m = data[0].length;   // 列数
    
  // 平均の計算
  const means = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      means[j] += data[i][j];
    }
    means[j] /= n;
  }
    
  // 標準偏差の計算
  const stds = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = data[i][j] - means[j];
      sumSq += diff * diff;
    }
    stds[j] = Math.sqrt(sumSq / n);
  }
    
  // 標準化
  const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      standardized[i][j] = stds[j] > 1e-10 ? (data[i][j] - means[j]) / stds[j] : 0;
    }
  }
    
  // 相関行列
  const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += standardized[k][i] * standardized[k][j];
      }
      corr[i][j] = sum / n;
    }
  }
    
  return corr;
}

// ============================================================================
// 部分空間正則化 PCA
// ============================================================================

class SubspaceRegularizedPCA {
  constructor(config) {
    this.config = config;
    this.V0 = null;
    this.D0 = null;
    this.C0 = null;
  }
    
  /**
     * 事前部分空間の構築
     */
  buildPriorSpace(nUs, nJp, sectorLabels, CFull) {
    const N = nUs + nJp;
    const keys = Object.keys(sectorLabels);

    // 1. グローバルファクター：全銘柄に等しい重み
    let v1 = new Array(N).fill(1);
    v1 = normalize(v1);

    // 2. 国スプレッドファクター：米国を正，日本を負
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

    // V0 = [v1, v2, v3] (N x 3 行列：列ベクトルを横に並べる)
    const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);

    // 事前方向の固有値を推定
    // D0 = diag(V0^T * C_full * V0)
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
    const C0 = matmul(matmul(invSqrtMat, C0Raw), invSqrtMat);

    // 対角要素を 1 に調整
    for (let i = 0; i < N; i++) {
      C0[i][i] = 1;
    }

    this.V0 = V0;
    this.D0 = D0;
    this.C0 = C0;
  }
    
  /**
     * 部分空間正則化 PCA の計算
     */
  computeRegularizedPCA(returns, sectorLabels, CFull) {
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
    const { eigenvalues, eigenvectors } = eigenDecposition(CReg, this.config.nFactors);
        
    // 固有ベクトルを列として格納
    const VK = transpose(eigenvectors);
        
    return { VK, eigenvalues, CReg };
  }
}

// ============================================================================
// リードラグシグナル
// ============================================================================

class LeadLagSignal {
  constructor(config) {
    this.config = config;
    this.pca = new SubspaceRegularizedPCA(config);
  }
    
  /**
     * リードラグ・シグナルの計算
     */
  computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
    // 結合リターン行列
    const nSamples = returnsUs.length;
    const nUs = returnsUs[0].length;
    const nJp = returnsJp[0].length;
        
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
        
    // 米国・日本に分割
    const VUs = VK.slice(0, nUs);
    const VJp = VK.slice(nUs);
        
    // 米国最新リターンの標準化
    const zUsLatest = returnsUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        
    // ファクタースコア: f_t = V_US^T * z_us_latest
    const fT = VUs.map(v => dotProduct(v, zUsLatest));
        
    // 日本側予測シグナル: signal = V_JP * f_t
    const signal = VJp.map(v => dotProduct(v, fT));
        
    return signal;
  }
}

// ============================================================================
// ポートフォリオ構築
// ============================================================================

/**
 * ロングショートポートフォリオの構築
 */
function buildPortfolio(signal, quantile = 0.3) {
  const n = signal.length;
  const q = Math.floor(n * quantile);
    
  // シグナルのインデックスをソート
  const indexed = signal.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);
    
  const longIdx = indexed.slice(-q).map(x => x.idx);
  const shortIdx = indexed.slice(0, q).map(x => x.idx);
    
  // 等ウェイト
  const weights = new Array(n).fill(0);
  for (const idx of longIdx) {
    weights[idx] = 1.0 / q;
  }
  for (const idx of shortIdx) {
    weights[idx] = -1.0 / q;
  }
    
  return weights;
}

// ============================================================================
// パフォーマンス指標
// ============================================================================

/**
 * パフォーマンス指標の計算
 */
function computePerformanceMetrics(returns, annualizationFactor = 252) {
  // 年率リターン
  const ar = returns.reduce((a, b) => a + b, 0) / returns.length * annualizationFactor;
    
  // 年率リスク（標準偏差）
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const risk = Math.sqrt(variance) * Math.sqrt(annualizationFactor);
    
  // リスク・リターン比
  const rr = risk > 0 ? ar / risk : 0;
    
  // 最大ドローダウン
  let cumulative = 1;
  const cumulativeArr = [];
  for (const r of returns) {
    cumulative *= (1 + r);
    cumulativeArr.push(cumulative);
  }
    
  let runningMax = cumulativeArr[0];
  let maxDrawdown = 0;
  for (const c of cumulativeArr) {
    if (c > runningMax) runningMax = c;
    const dd = (c - runningMax) / runningMax;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
    
  return {
    AR: ar,
    RISK: risk,
    RR: rr,
    MDD: maxDrawdown
  };
}

// ============================================================================
// データ取得（Yahoo Finance API の代替）
// ============================================================================

// ============================================================================
// バックテスト
// ============================================================================

/**
 * バックテストの実行
 */
function runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull) {
  const dates = returnsJpOc.map(x => x.date);
  const nJp = Object.keys(JP_ETF_TICKERS).length;
    
  const strategyReturns = [];
  const signalGenerator = new LeadLagSignal(config);
    
  for (let i = config.warmupPeriod; i < dates.length; i++) {
    // ウィンドウの取得
    const windowStart = i - config.windowLength;
    const windowEnd = i;
        
    // ウィンドウ内のリターン行列
    const retUsWindow = [];
    const retJpWindow = [];
    for (let j = windowStart; j < windowEnd; j++) {
      const usRow = returnsUs[j]?.values || new Array(Object.keys(US_ETF_TICKERS).length).fill(0);
      const jpRow = returnsJp[j]?.values || new Array(nJp).fill(0);
      retUsWindow.push(usRow);
      retJpWindow.push(jpRow);
    }
        
    // 米国最新リターン
    const retUsLatest = returnsUs[i - 1]?.values || new Array(Object.keys(US_ETF_TICKERS).length).fill(0);
        
    // シグナルの計算
    const signal = signalGenerator.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      sectorLabels,
      CFull
    );
        
    // ポートフォリオの構築
    const weights = buildPortfolio(signal, config.quantile);
        
    // 翌日リターン（Open-to-Close）
    const retNext = returnsJpOc[i]?.values || new Array(nJp).fill(0);
        
    // 戦略リターン
    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }
        
    strategyReturns.push({
      date: dates[i],
      return: strategyRet
    });
  }
    
  return strategyReturns;
}

/**
 * 単純モメンタム戦略（ベースライン）
 */
function runMomentumStrategy(returnsJp, returnsJpOc, window = 60, quantile = 0.3) {
  const dates = returnsJpOc.map(x => x.date);
  const nJp = Object.keys(JP_ETF_TICKERS).length;
    
  const strategyReturns = [];
    
  for (let i = window; i < dates.length; i++) {
    // ウィンドウ内のリターン平均（モメンタム）
    const momentum = new Array(nJp).fill(0);
    for (let j = i - window; j < i; j++) {
      const row = returnsJp[j]?.values || new Array(nJp).fill(0);
      for (let k = 0; k < nJp; k++) {
        momentum[k] += row[k];
      }
    }
    for (let k = 0; k < nJp; k++) {
      momentum[k] /= window;
    }
        
    // ポートフォリオ構築
    const weights = buildPortfolio(momentum, quantile);
        
    // 翌日リターン
    const retNext = returnsJpOc[i]?.values || new Array(nJp).fill(0);
        
    // 戦略リターン
    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }
        
    strategyReturns.push({
      date: dates[i],
      return: strategyRet
    });
  }
    
  return strategyReturns;
}

/**
 * 正則化なし PCA 戦略（ベースライン）
 */
function runPcaPlainStrategy(returnsUs, returnsJp, returnsJpOc, config, sectorLabels) {
  // 正則化なしの設定
  const configNoReg = {
    ...config,
    lambdaReg: 0.0
  };
    
  // ダミーの C_full
  const nUs = Object.keys(US_ETF_TICKERS).length;
  const nJp = Object.keys(JP_ETF_TICKERS).length;
  const CFullDummy = new Array(nUs + nJp).fill(0).map(() => new Array(nUs + nJp).fill(0));
  for (let i = 0; i < nUs + nJp; i++) {
    CFullDummy[i][i] = 1;
  }
    
  return runBacktest(returnsUs, returnsJp, returnsJpOc, configNoReg, sectorLabels, CFullDummy);
}

/**
 * ダブルソート戦略
 */
function runDoubleSortStrategy(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull) {
  const dates = returnsJpOc.map(x => x.date);
  const nJp = Object.keys(JP_ETF_TICKERS).length;
    
  const strategyReturns = [];
  const signalGenerator = new LeadLagSignal(config);
    
  for (let i = config.warmupPeriod; i < dates.length; i++) {
    const windowStart = i - config.windowLength;
    const windowEnd = i;
        
    const retUsWindow = [];
    const retJpWindow = [];
    for (let j = windowStart; j < windowEnd; j++) {
      const usRow = returnsUs[j]?.values || new Array(Object.keys(US_ETF_TICKERS).length).fill(0);
      const jpRow = returnsJp[j]?.values || new Array(nJp).fill(0);
      retUsWindow.push(usRow);
      retJpWindow.push(jpRow);
    }
        
    const retUsLatest = returnsUs[i - 1]?.values || new Array(Object.keys(US_ETF_TICKERS).length).fill(0);
        
    // PCA SUB シグナル
    const signalPca = signalGenerator.computeSignal(
      retUsWindow, retJpWindow, retUsLatest,
      sectorLabels, CFull
    );
        
    // モメンタムシグナル
    const momentum = new Array(nJp).fill(0);
    for (let j = 0; j < config.windowLength; j++) {
      const row = retJpWindow[j];
      for (let k = 0; k < nJp; k++) {
        momentum[k] += row[k];
      }
    }
    for (let k = 0; k < nJp; k++) {
      momentum[k] /= config.windowLength;
    }
        
    // ダブルソート（3 等分点で分割）
    const sortedPca = [...signalPca].sort((a, b) => a - b);
    const sortedMom = [...momentum].sort((a, b) => a - b);
    const pcaLow = sortedPca[Math.floor(nJp * DOUBLE_SORT_QUANTILES.low)];
    const pcaHigh = sortedPca[Math.floor(nJp * DOUBLE_SORT_QUANTILES.high)];
    const momLow = sortedMom[Math.floor(nJp * DOUBLE_SORT_QUANTILES.low)];
    const momHigh = sortedMom[Math.floor(nJp * DOUBLE_SORT_QUANTILES.high)];

    let longCount = 0;
    let shortCount = 0;

    for (let j = 0; j < nJp; j++) {
      if (signalPca[j] > pcaHigh && momentum[j] > momHigh) longCount++;
      else if (signalPca[j] < pcaLow && momentum[j] < momLow) shortCount++;
    }

    if (longCount === 0 || shortCount === 0) {
      strategyReturns.push({ date: dates[i], return: 0 });
      continue;
    }

    const weights = new Array(nJp).fill(0);
    for (let j = 0; j < nJp; j++) {
      if (signalPca[j] > pcaHigh && momentum[j] > momHigh) {
        weights[j] = 1.0 / longCount;
      } else if (signalPca[j] < pcaLow && momentum[j] < momLow) {
        weights[j] = -1.0 / shortCount;
      }
    }
        
    const retNext = returnsJpOc[i]?.values || new Array(nJp).fill(0);
    let strategyRet = 0;
    for (let j = 0; j < nJp; j++) {
      strategyRet += weights[j] * retNext[j];
    }
        
    strategyReturns.push({ date: dates[i], return: strategyRet });
  }
    
  return strategyReturns;
}

// ============================================================================
// メイン処理
// ============================================================================

/**
 * 長期相関行列 C_full の計算
 */
function computeCFull(returnsUs, returnsJp) {
  // 全期間のデータを使用（簡易版）
  const nUs = Object.keys(US_ETF_TICKERS).length;
  const nJp = Object.keys(JP_ETF_TICKERS).length;

  const combined = [];
  for (let i = 0; i < Math.min(returnsUs.length, returnsJp.length); i++) {
    const usRow = returnsUs[i]?.values || new Array(nUs).fill(0);
    const jpRow = returnsJp[i]?.values || new Array(nJp).fill(0);
    combined.push([...usRow, ...jpRow]);
  }

  return correlationMatrix(combined);
}

/**
 * 結果の出力
 */
function printResults(summary) {
  console.log('\n' + '='.repeat(60));
  console.log('戦略比較サマリー');
  console.log('='.repeat(60));
  console.log(
    'Strategy'.padEnd(15) +
        'AR (%)'.padStart(10) +
        'RISK (%)'.padStart(12) +
        'R/R'.padStart(10) +
        'MDD (%)'.padStart(12)
  );
  console.log('-'.repeat(60));
    
  for (const row of summary) {
    console.log(
      row.Strategy.padEnd(15) +
            row.AR.toFixed(2).padStart(10) +
            row.RISK.toFixed(2).padStart(12) +
            row.RR.toFixed(2).padStart(10) +
            row.MDD.toFixed(2).padStart(12)
    );
  }
}

/**
 * サンプルデータでのテスト
 */
function runTestWithSampleData() {
  console.log('='.repeat(60));
  console.log('日米業種リードラグ戦略 バックテスト（サンプルデータ）');
  console.log('='.repeat(60));
    
  // サンプルデータの生成（ランダムウォーク）
  const nDays = 500;
  const nUs = Object.keys(US_ETF_TICKERS).length;
  const nJp = Object.keys(JP_ETF_TICKERS).length;
    
  console.log(`\nサンプルデータ生成: ${nDays} 日間`);
  console.log(`米国セクター数：${nUs}`);
  console.log(`日本セクター数：${nJp}`);

  // リターンの生成（相関構造を含む）
  const generateReturns = (nDays, nCols, vol = 0.02) => {
    const returns = [];
    for (let i = 0; i < nDays; i++) {
      const row = new Array(nCols).fill(0).map(() => {
        // 正規分布からのサンプリング（Box-Muller）
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return z * vol;
      });
      returns.push({ date: `2020-01-${String(i % 31 + 1).padStart(2, '0')}`, values: row });
    }
    return returns;
  };

  const returnsUs = generateReturns(nDays, nUs, 0.015);
  const returnsJp = generateReturns(nDays, nJp, 0.018);
  const returnsJpOc = generateReturns(nDays, nJp, 0.012);
    
  // 長期相関行列の計算
  console.log('\n長期相関行列 C_full の計算中...');
  const CFull = computeCFull(returnsUs, returnsJp);
    
  // 設定
  const config = CONFIG;
    
  // ========================================================================
  // 戦略 1: 提案手法 (PCA SUB)
  // ========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('戦略 1: PCA SUB（部分空間正則化付き PCA）');
  console.log('='.repeat(60));
    
  const resultsSub = runBacktest(returnsUs, returnsJp, returnsJpOc, config, SECTOR_LABELS, CFull);
  const metricsSub = computePerformanceMetrics(resultsSub.map(r => r.return));
    
  console.log(`年率リターン (AR): ${(metricsSub.AR * 100).toFixed(2)}%`);
  console.log(`年率リスク (RISK): ${(metricsSub.RISK * 100).toFixed(2)}%`);
  console.log(`リスク・リターン比 (R/R): ${metricsSub.RR.toFixed(2)}`);
  console.log(`最大ドローダウン (MDD): ${(metricsSub.MDD * 100).toFixed(2)}%`);
    
  // ========================================================================
  // 戦略 2: 単純モメンタム (MOM)
  // ========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('戦略 2: MOM（単純モメンタム）');
  console.log('='.repeat(60));
    
  const resultsMom = runMomentumStrategy(returnsJp, returnsJpOc);
  const metricsMom = computePerformanceMetrics(resultsMom.map(r => r.return));
    
  console.log(`年率リターン (AR): ${(metricsMom.AR * 100).toFixed(2)}%`);
  console.log(`年率リスク (RISK): ${(metricsMom.RISK * 100).toFixed(2)}%`);
  console.log(`リスク・リターン比 (R/R): ${metricsMom.RR.toFixed(2)}`);
  console.log(`最大ドローダウン (MDD): ${(metricsMom.MDD * 100).toFixed(2)}%`);
    
  // ========================================================================
  // 戦略 3: 正則化なし PCA (PCA PLAIN)
  // ========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('戦略 3: PCA PLAIN（正則化なし PCA）');
  console.log('='.repeat(60));
    
  const resultsPlain = runPcaPlainStrategy(returnsUs, returnsJp, returnsJpOc, config, SECTOR_LABELS);
  const metricsPlain = computePerformanceMetrics(resultsPlain.map(r => r.return));
    
  console.log(`年率リターン (AR): ${(metricsPlain.AR * 100).toFixed(2)}%`);
  console.log(`年率リスク (RISK): ${(metricsPlain.RISK * 100).toFixed(2)}%`);
  console.log(`リスク・リターン比 (R/R): ${metricsPlain.RR.toFixed(2)}`);
  console.log(`最大ドローダウン (MDD): ${(metricsPlain.MDD * 100).toFixed(2)}%`);
    
  // ========================================================================
  // 戦略 4: ダブルソート (DOUBLE)
  // ========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('戦略 4: DOUBLE（モメンタム × PCA SUB）');
  console.log('='.repeat(60));
    
  const resultsDouble = runDoubleSortStrategy(returnsUs, returnsJp, returnsJpOc, config, SECTOR_LABELS, CFull);
  const metricsDouble = computePerformanceMetrics(resultsDouble.map(r => r.return));
    
  console.log(`年率リターン (AR): ${(metricsDouble.AR * 100).toFixed(2)}%`);
  console.log(`年率リスク (RISK): ${(metricsDouble.RISK * 100).toFixed(2)}%`);
  console.log(`リスク・リターン比 (R/R): ${metricsDouble.RR.toFixed(2)}`);
  console.log(`最大ドローダウン (MDD): ${(metricsDouble.MDD * 100).toFixed(2)}%`);
    
  // ========================================================================
  // 結果の比較
  // ========================================================================
  const summary = [
    { Strategy: 'MOM', AR: metricsMom.AR * 100, RISK: metricsMom.RISK * 100, RR: metricsMom.RR, MDD: metricsMom.MDD * 100 },
    { Strategy: 'PCA PLAIN', AR: metricsPlain.AR * 100, RISK: metricsPlain.RISK * 100, RR: metricsPlain.RR, MDD: metricsPlain.MDD * 100 },
    { Strategy: 'PCA SUB', AR: metricsSub.AR * 100, RISK: metricsSub.RISK * 100, RR: metricsSub.RR, MDD: metricsSub.MDD * 100 },
    { Strategy: 'DOUBLE', AR: metricsDouble.AR * 100, RISK: metricsDouble.RISK * 100, RR: metricsDouble.RR, MDD: metricsDouble.MDD * 100 }
  ];
    
  printResults(summary);
    
  // 結果の保存
  const outputDir = 'lead_lag_strategy';
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
    
  const summaryCSV = 'Strategy,AR (%),RISK (%),R/R,MDD (%)\n' +
        summary.map(r => `${r.Strategy},${r.AR.toFixed(4)},${r.RISK.toFixed(4)},${r.RR.toFixed(4)},${r.MDD.toFixed(4)}`).join('\n');
  writeFileSync(path.join(outputDir, 'backtest_summary.csv'), summaryCSV);
    
  console.log('\n結果を保存しました：lead_lag_strategy/backtest_summary.csv');
    
  return summary;
}

// メイン実行
console.log('部分空間正則化付き PCA リードラグ戦略');
console.log('Reference: 中川慧 et al. (2025)');
console.log('');

runTestWithSampleData();
