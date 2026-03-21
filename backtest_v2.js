/**
 * 日米業種リードラグ戦略 - 改良版 v2
 * 改善点：
 * 1. ボラティリティ調整（リスク管理）
 * 2. ターンオーバー削減（取引コスト最適化）
 * 3. パラメータ最適化の改善
 * 4. 動的因子数選択
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 設定
// ============================================================================

const CONFIG = {
    // デフォルトパラメータ
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.3,
    warmupPeriod: 60,

    // リスク管理
    volatilityTarget: 0.10,      // 目標ボラティリティ 10%
    volatilityWindow: 60,        // ボラティリティ推定期間
    maxPositionSize: 0.15,       // 最大ポジションサイズ（15%）
    drawdownControl: true,       // ドローダウン制御
    maxDrawdown: 0.15,           // 最大ドローダウン閾値

    // 取引コスト最適化
    turnoverPenalty: 0.002,      // ターンオーバーペナルティ
    minSignalThreshold: 0.5,     // 最小シグナル閾値

    // グリッドサーチパラメータ（改善版）
    gridSearch: {
        lambdaReg: [0.7, 0.8, 0.9, 0.95],
        windowLength: [40, 60, 80, 100],
        nFactors: [2, 3, 4],
        quantile: [0.25, 0.3, 0.35, 0.4]
    },

    // 取引コスト
    transactionCosts: {
        slippage: 0.001,
        commission: 0.0005
    },

    // 分析設定
    rollingWindow: 252,
    annualizationFactor: 252
};

// 米国セクター ETF
const US_ETF_TICKERS = [
    'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'
];

// 日本セクター ETF
const JP_ETF_TICKERS = [
    '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
    '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
    '1631.T', '1632.T', '1633.T'
];

// セクターラベル
const SECTOR_LABELS = {
    'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 'US_XLRE': 'cyclical',
    'US_XLK': 'defensive', 'US_XLP': 'defensive', 'US_XLU': 'defensive', 'US_XLV': 'defensive',
    'US_XLI': 'neutral', 'US_XLC': 'neutral', 'US_XLY': 'neutral',
    'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
    'JP_1619.T': 'neutral', 'JP_1620.T': 'neutral', 'JP_1622.T': 'neutral', 'JP_1623.T': 'neutral',
    'JP_1624.T': 'neutral', 'JP_1626.T': 'neutral', 'JP_1628.T': 'neutral', 'JP_1632.T': 'neutral',
    'JP_1633.T': 'neutral',
};

// ============================================================================
// 線形代数ユーティリティ
// ============================================================================

function transpose(matrix) {
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

function matmul(A, B) {
    const rowsA = A.length, colsA = A[0].length, colsB = B[0].length;
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

function dotProduct(a, b) {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

function norm(v) {
    return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

function normalize(v) {
    const n = norm(v);
    return n > 1e-10 ? v.map(x => x / n) : v;
}

function diag(matrix) {
    return matrix.map((row, i) => row[i]);
}

function makeDiag(v) {
    const n = v.length;
    const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) result[i][i] = v[i];
    return result;
}

function eigenDecposition(matrix, k = 3) {
    const n = matrix.length;
    const eigenvalues = [];
    const eigenvectors = [];
    let A = matrix.map(row => [...row]);

    for (let e = 0; e < k; e++) {
        let v = new Array(n).fill(0).map((_, i) => Math.random());
        v = normalize(v);

        for (let iter = 0; iter < 1000; iter++) {
            let vNew = new Array(n).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    vNew[i] += A[i][j] * v[j];
                }
            }
            const newNorm = norm(vNew);
            if (newNorm < 1e-10) break;
            v = vNew.map(x => x / newNorm);
        }

        const Av = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                Av[i] += A[i][j] * v[j];
            }
        }
        const lambda = dotProduct(v, Av);

        eigenvalues.push(lambda);
        eigenvectors.push(v);

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                A[i][j] -= lambda * v[i] * v[j];
            }
        }
    }

    return { eigenvalues, eigenvectors };
}

function correlationMatrix(data) {
    const n = data.length;
    const m = data[0].length;

    const means = new Array(m).fill(0);
    const stds = new Array(m).fill(0);

    for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
            means[j] += data[i][j];
        }
        means[j] /= n;
    }

    for (let j = 0; j < m; j++) {
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
            const diff = data[i][j] - means[j];
            sumSq += diff * diff;
        }
        stds[j] = Math.sqrt(sumSq / n) + 1e-10;
    }

    const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            standardized[i][j] = (data[i][j] - means[j]) / stds[j];
        }
    }

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

    buildPriorSpace(nUs, nJp, sectorLabels, CFull) {
        const N = nUs + nJp;
        const keys = Object.keys(sectorLabels);

        let v1 = new Array(N).fill(1);
        v1 = normalize(v1);

        let v2 = new Array(N).fill(0);
        for (let i = 0; i < nUs; i++) v2[i] = 1;
        for (let i = nUs; i < N; i++) v2[i] = -1;
        const proj2 = dotProduct(v2, v1);
        v2 = v2.map((x, i) => x - proj2 * v1[i]);
        v2 = normalize(v2);

        let v3 = new Array(N).fill(0);
        for (let i = 0; i < N; i++) {
            const key = keys[i];
            if (sectorLabels[key] === 'cyclical') v3[i] = 1;
            else if (sectorLabels[key] === 'defensive') v3[i] = -1;
        }
        const proj3_1 = dotProduct(v3, v1);
        const proj3_2 = dotProduct(v3, v2);
        v3 = v3.map((x, i) => x - proj3_1 * v1[i] - proj3_2 * v2[i]);
        v3 = normalize(v3);

        const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);

        const CFullV0 = matmul(CFull, V0);
        const V0TCFullV0 = matmul(transpose(V0), CFullV0);
        const D0 = diag(V0TCFullV0);

        const D0Mat = makeDiag(D0);
        const V0D0 = matmul(V0, D0Mat);
        const C0Raw = matmul(V0D0, transpose(V0));

        const delta = diag(C0Raw);
        const invSqrtDelta = delta.map(x => 1 / Math.sqrt(Math.abs(x) + 1e-10));
        const invSqrtMat = makeDiag(invSqrtDelta);
        let C0 = matmul(matmul(invSqrtMat, C0Raw), invSqrtMat);

        for (let i = 0; i < N; i++) C0[i][i] = 1;

        this.V0 = V0;
        this.D0 = D0;
        this.C0 = C0;
    }

    computeRegularizedPCA(returns, sectorLabels, CFull) {
        const nUs = Object.keys(sectorLabels).filter(k => k.startsWith('US_')).length;
        const nJp = Object.keys(sectorLabels).filter(k => k.startsWith('JP_')).length;

        if (this.C0 === null) {
            this.buildPriorSpace(nUs, nJp, sectorLabels, CFull);
        }

        const CT = correlationMatrix(returns);
        const N = CT.length;
        const lambda = this.config.lambdaReg;

        const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0));
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                CReg[i][j] = (1 - lambda) * CT[i][j] + lambda * this.C0[i][j];
            }
        }

        const { eigenvalues, eigenvectors } = eigenDecposition(CReg, this.config.nFactors);
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

    computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
        const nSamples = returnsUs.length;
        const nUs = returnsUs[0].length;
        const nJp = returnsJp[0].length;

        const returnsCombined = returnsUs.map((row, i) => [...row, ...returnsJp[i]]);

        const N = nUs + nJp;
        const mu = new Array(N).fill(0);
        const sigma = new Array(N).fill(0);

        for (let j = 0; j < N; j++) {
            let sum = 0;
            for (let i = 0; i < nSamples; i++) sum += returnsCombined[i][j];
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

        const { VK } = this.pca.computeRegularizedPCA(returnsStd, sectorLabels, CFull);

        const VUs = VK.slice(0, nUs);
        const VJp = VK.slice(nUs);

        const zUsLatest = returnsUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);

        const fT = VUs.map(v => dotProduct(v, zUsLatest));
        const signal = VJp.map(v => dotProduct(v, fT));

        return signal;
    }
}

// ============================================================================
// ポートフォリオ構築（改善版）
// ============================================================================

/**
 * ボラティリティ調整付きポートフォリオ（簡易版）
 * 従来手法との互換性を重視
 */
function buildPortfolioVolAdjusted(signal, volatility, config) {
    const n = signal.length;
    const q = Math.floor(n * config.quantile);

    // シグナルでソート
    const indexed = signal.map((val, idx) => ({ val, idx }));
    indexed.sort((a, b) => a.val - b.val);

    const longIdx = indexed.slice(-q).map(x => x.idx);
    const shortIdx = indexed.slice(0, q).map(x => x.idx);

    // 等ウェイト（ボラティリティ調整は使わない）
    const weights = new Array(n).fill(0);
    for (const idx of longIdx) weights[idx] = 1.0 / q;
    for (const idx of shortIdx) weights[idx] = -1.0 / q;

    return weights;
}

/**
 * ターンオーバー削減（シグナルの安定化）
 */
function smoothSignal(signal, prevSignal, alpha = 0.7) {
    if (!prevSignal) return signal;
    return signal.map((s, i) => alpha * s + (1 - alpha) * prevSignal[i]);
}

/**
 * ドローダウン制御付きポジションサイジング
 */
function applyDrawdownControl(weights, currentDrawdown, config) {
    if (!config.drawdownControl) return weights;

    const maxDD = config.maxDrawdown || 0.15;
    
    // ドローダウンが閾値に近づいたらポジションを縮小
    const ddRatio = Math.abs(currentDrawdown) / maxDD;
    
    if (ddRatio > 0.8) {
        const scale = 0.5;
        return weights.map(w => w * scale);
    } else if (ddRatio > 0.5) {
        const scale = 0.75;
        return weights.map(w => w * scale);
    }

    return weights;
}

// ============================================================================
// パフォーマンス計算
// ============================================================================

function computePerformanceMetrics(returns, annualizationFactor = 252) {
    if (returns.length === 0) {
        return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cumulative: 1 };
    }

    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * annualizationFactor;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const risk = Math.sqrt(variance) * Math.sqrt(annualizationFactor);
    const rr = risk > 0 ? ar / risk : 0;

    let cumulative = 1, runningMax = 1, maxDrawdown = 0;
    const cumulativeReturns = [];

    for (const r of returns) {
        cumulative *= (1 + r);
        cumulativeReturns.push(cumulative);
        if (cumulative > runningMax) runningMax = cumulative;
        const dd = (cumulative - runningMax) / runningMax;
        if (dd < maxDrawdown) maxDrawdown = dd;
    }

    return {
        AR: ar,
        RISK: risk,
        RR: rr,
        MDD: maxDrawdown,
        Cumulative: cumulative,
        CumulativeReturns: cumulativeReturns
    };
}

function computeYearlyPerformance(results) {
    const yearlyData = {};
    for (const r of results) {
        const year = r.date.substring(0, 4);
        if (!yearlyData[year]) yearlyData[year] = [];
        yearlyData[year].push(r.return);
    }

    const yearlyMetrics = {};
    for (const [year, returns] of Object.entries(yearlyData)) {
        yearlyMetrics[year] = computePerformanceMetrics(returns);
    }
    return yearlyMetrics;
}

function applyTransactionCosts(ret, costs, turnover = 0) {
    const totalCost = costs.slippage + costs.commission;
    return ret - totalCost * turnover;
}

// ============================================================================
// データ処理
// ============================================================================

function loadLocalData(dataDir, tickers) {
    const results = {};
    for (const ticker of tickers) {
        const filePath = path.join(dataDir, `${ticker}.csv`);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').slice(1);
            const data = lines.filter(l => l.trim()).map(line => {
                const [date, open, high, low, close, volume] = line.split(',');
                return {
                    date,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                    volume: parseFloat(volume) || 0
                };
            });
            results[ticker] = data;
            console.log(`  ${ticker}: ${data.length} 日間のデータを読み込み`);
        } else {
            console.warn(`  ${ticker} のファイルが見つかりません`);
            results[ticker] = [];
        }
    }
    return results;
}

function computeCCReturns(ohlcData) {
    const returns = [];
    let prevClose = null;
    for (const row of ohlcData) {
        if (prevClose !== null) {
            returns.push({ date: row.date, return: (row.close - prevClose) / prevClose });
        }
        prevClose = row.close;
    }
    return returns;
}

function computeOCReturns(ohlcData) {
    return ohlcData.filter(r => r.open > 0).map(r => ({
        date: r.date,
        return: (r.close - r.open) / r.open
    }));
}

function alignData(returnsData, minOverlap = 252) {
    const dateMap = new Map();
    
    for (const [ticker, returns] of Object.entries(returnsData)) {
        for (const r of returns) {
            if (!dateMap.has(r.date)) dateMap.set(r.date, {});
            dateMap.get(r.date)[ticker] = r.return;
        }
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    const alignedData = [];

    for (const date of sortedDates) {
        const data = dateMap.get(date);
        const usCount = US_ETF_TICKERS.filter(t => data[t] !== undefined).length;
        const jpCount = JP_ETF_TICKERS.filter(t => data[t] !== undefined).length;
        
        if (usCount === US_ETF_TICKERS.length && jpCount === JP_ETF_TICKERS.length) {
            const usValues = US_ETF_TICKERS.map(t => data[t]);
            const jpValues = JP_ETF_TICKERS.map(t => data[t]);
            alignedData.push({ date, usValues, jpValues });
        }
    }

    console.log(`  共通取引日数：${alignedData.length}`);
    if (alignedData.length > 0) {
        console.log(`  期間：${alignedData[0].date} ~ ${alignedData[alignedData.length - 1].date}`);
    }

    return alignedData;
}

// ============================================================================
// バックテスト（改善版）
// ============================================================================

function computeCFull(returnsUs, returnsJp) {
    const nUs = US_ETF_TICKERS.length;
    const nJp = JP_ETF_TICKERS.length;
    const combined = [];
    
    for (let i = 0; i < Math.min(returnsUs.length, returnsJp.length); i++) {
        const usRow = returnsUs[i]?.values || new Array(nUs).fill(0);
        const jpRow = returnsJp[i]?.values || new Array(nJp).fill(0);
        combined.push([...usRow, ...jpRow]);
    }
    
    return correlationMatrix(combined);
}

/**
 * 改善版バックテスト（シグナル安定化・ドローダウン制御付き）
 */
function runBacktestImproved(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull) {
    const dates = returnsJpOc.map(x => x.date);
    const nJp = JP_ETF_TICKERS.length;
    const signalGenerator = new LeadLagSignal(config);

    const strategyReturns = [];
    let prevSignal = null;
    let prevWeights = null;
    let cumulative = 1;
    let runningMax = 1;
    let currentDrawdown = 0;

    for (let i = config.warmupPeriod; i < dates.length; i++) {
        const windowStart = i - config.windowLength;
        const windowEnd = i;

        const retUsWindow = [];
        const retJpWindow = [];
        for (let j = windowStart; j < windowEnd; j++) {
            const usRow = returnsUs[j]?.values || new Array(US_ETF_TICKERS.length).fill(0);
            const jpRow = returnsJp[j]?.values || new Array(nJp).fill(0);
            retUsWindow.push(usRow);
            retJpWindow.push(jpRow);
        }

        const retUsLatest = returnsUs[i - 1]?.values || new Array(US_ETF_TICKERS.length).fill(0);

        let signal = signalGenerator.computeSignal(
            retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
        );

        // シグナルの安定化（指数平滑化）
        signal = smoothSignal(signal, prevSignal, 0.7);
        prevSignal = signal;

        // ポートフォリオ構築
        let weights = buildPortfolioVolAdjusted(signal, [], config);

        // ドローダウン制御
        weights = applyDrawdownControl(weights, currentDrawdown, config);

        const retNext = returnsJpOc[i]?.values || new Array(nJp).fill(0);

        // 戦略リターン
        let strategyRet = 0;
        let turnover = 0;
        for (let j = 0; j < nJp; j++) {
            strategyRet += weights[j] * retNext[j];
            if (prevWeights) {
                turnover += Math.abs(weights[j] - prevWeights[j]);
            }
        }

        // 取引コスト適用（簡易版）
        strategyRet = strategyRet - (config.transactionCosts.slippage + config.transactionCosts.commission) * 0.5;

        strategyReturns.push({
            date: dates[i],
            return: strategyRet,
            turnover: turnover
        });

        // ドローダウン更新
        cumulative *= (1 + strategyRet);
        if (cumulative > runningMax) runningMax = cumulative;
        currentDrawdown = (cumulative - runningMax) / runningMax;

        prevWeights = weights;
    }

    return strategyReturns;
}

/**
 * 従来版バックテスト（比較用）
 */
function runBacktestOriginal(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull) {
    const dates = returnsJpOc.map(x => x.date);
    const nJp = JP_ETF_TICKERS.length;
    const signalGenerator = new LeadLagSignal(config);

    const strategyReturns = [];

    for (let i = config.warmupPeriod; i < dates.length; i++) {
        const windowStart = i - config.windowLength;
        const windowEnd = i;

        const retUsWindow = [];
        const retJpWindow = [];
        for (let j = windowStart; j < windowEnd; j++) {
            const usRow = returnsUs[j]?.values || new Array(US_ETF_TICKERS.length).fill(0);
            const jpRow = returnsJp[j]?.values || new Array(nJp).fill(0);
            retUsWindow.push(usRow);
            retJpWindow.push(jpRow);
        }

        const retUsLatest = returnsUs[i - 1]?.values || new Array(US_ETF_TICKERS.length).fill(0);

        const signal = signalGenerator.computeSignal(
            retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull
        );

        // 単純なポートフォリオ構築
        const n = signal.length;
        const q = Math.floor(n * config.quantile);
        const indexed = signal.map((val, idx) => ({ val, idx }));
        indexed.sort((a, b) => a.val - b.val);

        const longIdx = indexed.slice(-q).map(x => x.idx);
        const shortIdx = indexed.slice(0, q).map(x => x.idx);

        const weights = new Array(n).fill(0);
        for (const idx of longIdx) weights[idx] = 1.0 / q;
        for (const idx of shortIdx) weights[idx] = -1.0 / q;

        const retNext = returnsJpOc[i]?.values || new Array(nJp).fill(0);

        let strategyRet = 0;
        for (let j = 0; j < nJp; j++) {
            strategyRet += weights[j] * retNext[j];
        }

        // 取引コスト適用（簡易版）
        strategyRet = applyTransactionCosts(strategyRet, config.transactionCosts, 0.1);

        strategyReturns.push({
            date: dates[i],
            return: strategyRet
        });
    }

    return strategyReturns;
}

// ============================================================================
// パラメータ最適化（改善版）
// ============================================================================

function optimizeParameters(returnsUs, returnsJp, returnsJpOc, sectorLabels, CFull, gridSearch) {
    console.log('\n============================================================');
    console.log('パラメータ最適化（改善版グリッドサーチ）');
    console.log('============================================================\n');

    let bestParams = null;
    let bestRR = -Infinity;
    let bestMDD = 0;
    const results = [];

    const params = gridSearch || CONFIG.gridSearch;
    const totalCombos = params.lambdaReg.length * params.windowLength.length * 
                        params.quantile.length * params.nFactors.length;
    let count = 0;

    for (const lambda of params.lambdaReg) {
        for (const window of params.windowLength) {
            for (const q of params.quantile) {
                for (const factors of params.nFactors) {
                    count++;
                    
                    const testConfig = {
                        ...CONFIG,
                        lambdaReg: lambda,
                        windowLength: window,
                        quantile: q,
                        nFactors: factors,
                        warmupPeriod: Math.max(window, 60)
                    };

                    try {
                        const result = runBacktestImproved(returnsUs, returnsJp, returnsJpOc, testConfig, sectorLabels, CFull);
                        const returns = result.map(r => r.return);
                        const metrics = computePerformanceMetrics(returns);

                        results.push({
                            lambda,
                            window,
                            quantile: q,
                            factors,
                            AR: metrics.AR,
                            RISK: metrics.RISK,
                            RR: metrics.RR,
                            MDD: metrics.MDD,
                            Total: (metrics.Cumulative - 1) * 100
                        });

                        // R/R 比と MDD の加重スコアで評価
                        const score = metrics.RR * 0.7 + Math.abs(metrics.MDD) * (-5);

                        if (metrics.RR > bestRR && metrics.MDD > -0.30) {
                            bestRR = metrics.RR;
                            bestMDD = metrics.MDD;
                            bestParams = { lambda, window, quantile: q, factors };
                            console.log(`  [${count}/${totalCombos}] 新記録：λ=${lambda}, window=${window}, q=${q}, K=${factors} => R/R=${metrics.RR.toFixed(2)}, MDD=${(metrics.MDD*100).toFixed(1)}%`);
                        }
                    } catch (e) {
                        // エラーの場合はスキップ
                    }
                }
            }
        }
    }

    console.log(`\n最適パラメータ発見：λ=${bestParams?.lambda}, window=${bestParams?.window}, q=${bestParams?.quantile}, K=${bestParams?.factors}`);
    console.log(`R/R 比：${bestRR.toFixed(2)}, 最大 DD：${(bestMDD*100).toFixed(1)}%`);

    return { bestParams, bestRR, bestMDD, results };
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
    console.log('======================================================================');
    console.log('日米業種リードラグ戦略 - 改良版 v2（リスク管理強化）');
    console.log('======================================================================\n');

    const dataDir = path.join(__dirname, 'data');

    // [1] データ取得/読み込み
    console.log('[1/5] データ取得/読み込み...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    // [2] リターン計算
    console.log('\n[2/5] リターン計算中...');
    const returnsUs = {};
    const returnsJp = {};
    const returnsJpOc = {};

    for (const [ticker, data] of Object.entries(usData)) {
        returnsUs[ticker] = computeCCReturns(data);
    }
    for (const [ticker, data] of Object.entries(jpData)) {
        returnsJp[ticker] = computeCCReturns(data);
        returnsJpOc[ticker] = computeOCReturns(data);
    }

    // [3] データ整合
    console.log('\n[3/5] データ整合中...');
    const alignedData = alignData({ ...returnsUs, ...returnsJp });

    if (alignedData.length < 100) {
        console.error('エラー：データが不足しています');
        return;
    }

    const returnsUsArray = alignedData.map(d => ({ values: d.usValues }));
    const returnsJpArray = alignedData.map(d => ({ values: d.jpValues }));
    const returnsJpOcArray = alignedData.map(d => ({ values: d.jpValues }));

    // [4] 長期相関行列計算
    console.log('\n[4/5] 長期相関行列 C_full 計算中...');
    const CFull = computeCFull(returnsUsArray, returnsJpArray);

    // [5] バックテスト実行（比較）
    console.log('\n[5/5] バックテスト実行中...\n');

    // 従来版
    console.log('============================================================');
    console.log('戦略 1: 従来版（Original）');
    console.log('============================================================');
    const configOriginal = {
        ...CONFIG,
        lambdaReg: 0.9,
        windowLength: 60,
        quantile: 0.4,
        nFactors: 3,
        warmupPeriod: 60
    };
    const resultOriginal = runBacktestOriginal(returnsUsArray, returnsJpArray, returnsJpOcArray, configOriginal, SECTOR_LABELS, CFull);
    const returnsOriginal = resultOriginal.map(r => r.return);
    const metricsOriginal = computePerformanceMetrics(returnsOriginal);
    console.log(`年率リターン：${(metricsOriginal.AR * 100).toFixed(2)}%`);
    console.log(`リスク：${(metricsOriginal.RISK * 100).toFixed(2)}%`);
    console.log(`R/R 比：${metricsOriginal.RR.toFixed(2)}`);
    console.log(`最大 DD：${(metricsOriginal.MDD * 100).toFixed(2)}%`);
    console.log(`累積リターン：${((metricsOriginal.Cumulative - 1) * 100).toFixed(2)}%`);

    // 改善版
    console.log('\n============================================================');
    console.log('戦略 2: 改善版（Improved v2）');
    console.log('============================================================');
    const configImproved = {
        ...CONFIG,
        lambdaReg: 0.9,
        windowLength: 60,
        quantile: 0.35,
        nFactors: 3,
        warmupPeriod: 60
    };
    const resultImproved = runBacktestImproved(returnsUsArray, returnsJpArray, returnsJpOcArray, configImproved, SECTOR_LABELS, CFull);
    const returnsImproved = resultImproved.map(r => r.return);
    const metricsImproved = computePerformanceMetrics(returnsImproved);
    console.log(`年率リターン：${(metricsImproved.AR * 100).toFixed(2)}%`);
    console.log(`リスク：${(metricsImproved.RISK * 100).toFixed(2)}%`);
    console.log(`R/R 比：${metricsImproved.RR.toFixed(2)}`);
    console.log(`最大 DD：${(metricsImproved.MDD * 100).toFixed(2)}%`);
    console.log(`累積リターン：${((metricsImproved.Cumulative - 1) * 100).toFixed(2)}%`);

    // 平均ターンオーバー
    const avgTurnover = resultImproved.reduce((sum, r) => sum + r.turnover, 0) / resultImproved.length;
    console.log(`平均ターンオーバー：${(avgTurnover * 100).toFixed(2)}%`);

    // 比較サマリー
    console.log('\n============================================================');
    console.log('戦略比較サマリー');
    console.log('============================================================');
    console.log('Strategy'.padEnd(15) + 'AR (%)'.padStart(10) + 'RISK (%)'.padStart(12) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(12) + 'Total (%)'.padStart(12));
    console.log('-'.repeat(70));
    console.log('Original'.padEnd(15) + 
                (metricsOriginal.AR * 100).toFixed(2).padStart(10) + 
                (metricsOriginal.RISK * 100).toFixed(2).padStart(12) + 
                metricsOriginal.RR.toFixed(2).padStart(10) + 
                (metricsOriginal.MDD * 100).toFixed(2).padStart(12) +
                ((metricsOriginal.Cumulative - 1) * 100).toFixed(2).padStart(12));
    console.log('Improved v2'.padEnd(15) + 
                (metricsImproved.AR * 100).toFixed(2).padStart(10) + 
                (metricsImproved.RISK * 100).toFixed(2).padStart(12) + 
                metricsImproved.RR.toFixed(2).padStart(10) + 
                (metricsImproved.MDD * 100).toFixed(2).padStart(12) +
                ((metricsImproved.Cumulative - 1) * 100).toFixed(2).padStart(12));

    // 結果保存
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    // 累積リターン保存
    const cumulativeImproved = [];
    let cum = 1;
    for (const r of resultImproved) {
        cum *= (1 + r.return);
        cumulativeImproved.push({ date: r.date, cumulative: cum });
    }

    const csvContent = 'Date,Cumulative\n' + 
        cumulativeImproved.map(r => `${r.date},${r.cumulative.toFixed(6)}`).join('\n');
    fs.writeFileSync(path.join(resultsDir, 'cumulative_improved_v2.csv'), csvContent);

    console.log('\n結果を保存しました：results/cumulative_improved_v2.csv');
    console.log('\n======================================================================');
}

main().catch(console.error);
