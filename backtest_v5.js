/**
 * 日米業種リードラグ戦略 - 改良版 v5
 * 改善点：
 * 1. シグナル閾値フィルタ（無駄な売買削減）
 * 2. 取引コストモデルの改善
 * 3. 複数パラメータの即時比較
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
    quantile: 0.4,
    warmupPeriod: 60,
    
    // 新規：シグナル閾値
    signalThreshold: 0.5,  // 相対シグナル閾値（中央値の 50%）

    // グリッドサーチパラメータ（削減版）
    gridSearch: {
        lambdaReg: [0.85, 0.9, 0.95],
        windowLength: [40, 60, 80],
        nFactors: [2, 3, 4],
        quantile: [0.3, 0.35, 0.4]
    },

    // 取引コスト
    transactionCosts: {
        slippage: 0.001,    // 0.1%
        commission: 0.0005  // 0.05%
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
// データ取得（モック - 実際のデータ取得用）
// ============================================================================

async function fetchYahooFinanceData(ticker, startDate = '2015-01-01', endDate = '2025-12-31') {
    console.log(`  ${ticker} のデータ取得中...`);
    
    try {
        const YahooFinance = require('yahoo-finance2').default;
        const yahooFinance = new YahooFinance();
        const queryOptions = { period1: startDate, period2: endDate, interval: '1d' };
        const result = await yahooFinance.chart(ticker, queryOptions);

        const data = result.quotes.map(q => ({
            date: q.date.toISOString().split('T')[0],
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume
        })).filter(d => d.close !== null && d.close > 0);

        console.log(`  ${ticker}: ${data.length} 日間のデータを取得`);
        return data;
    } catch (e) {
        console.error(`  ${ticker} の取得エラー：${e.message}`);
        return [];
    }
}

async function fetchAllData(tickers) {
    const results = {};
    for (const ticker of tickers) {
        const data = await fetchYahooFinanceData(ticker);
        results[ticker] = data;
    }
    return results;
}

// ローカルデータ読み込み（CSV から）
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

function dotProduct(a, b) { return a.reduce((sum, val, i) => sum + val * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0)); }
function normalize(v) { const n = norm(v); return v.map(x => x / (n + 1e-10)); }
function diag(matrix) { return matrix.map((row, i) => row[i]); }
function makeDiag(v) {
    const n = v.length;
    const result = new Array(n).fill(0).map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) result[i][i] = v[i];
    return result;
}

function eigenDecomposition(matrix, k = 3) {
    const n = matrix.length;
    const eigenvalues = [], eigenvectors = [];
    let A = matrix.map(row => [...row]);

    for (let e = 0; e < k; e++) {
        let v = new Array(n).fill(0).map((_, i) => Math.random());
        v = normalize(v);

        for (let iter = 0; iter < 1000; iter++) {
            let vNew = new Array(n).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) vNew[i] += A[i][j] * v[j];
            }
            const newNorm = norm(vNew);
            if (newNorm < 1e-10) break;
            v = vNew.map(x => x / newNorm);
        }

        const Av = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j];
        }
        const lambda = dotProduct(v, Av);
        eigenvalues.push(lambda);
        eigenvectors.push(v);

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) A[i][j] -= lambda * v[i] * v[j];
        }
    }

    return { eigenvalues, eigenvectors };
}

function correlationMatrix(data) {
    const n = data.length, m = data[0].length;
    const means = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) means[j] += data[i][j];
        means[j] /= n;
    }

    const stds = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
            const diff = data[i][j] - means[j];
            sumSq += diff * diff;
        }
        stds[j] = Math.sqrt(sumSq / n);
    }

    const standardized = new Array(n).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            standardized[i][j] = stds[j] > 1e-10 ? (data[i][j] - means[j]) / stds[j] : 0;
        }
    }

    const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
            let sum = 0;
            for (let k = 0; k < n; k++) sum += standardized[k][i] * standardized[k][j];
            corr[i][j] = sum / n;
        }
    }
    return corr;
}

// ============================================================================
// PCA クラス
// ============================================================================

class SubspaceRegularizedPCA {
    constructor(config) { 
        this.config = config; 
        this.C0 = null;
    }

    buildPriorSpace(nUs, nJp, sectorLabels, CFull) {
        const N = nUs + nJp;
        const keys = Object.keys(sectorLabels);

        let v1 = normalize(new Array(N).fill(1));

        let v2 = new Array(N).fill(0);
        for (let i = 0; i < nUs; i++) v2[i] = 1;
        for (let i = nUs; i < N; i++) v2[i] = -1;
        v2 = normalize(v2.map((x, i) => x - dotProduct(v2, v1) * v1[i]));

        let v3 = new Array(N).fill(0);
        for (let i = 0; i < N; i++) {
            const key = keys[i];
            if (sectorLabels[key] === 'cyclical') v3[i] = 1;
            else if (sectorLabels[key] === 'defensive') v3[i] = -1;
        }
        v3 = v3.map((x, i) => x - dotProduct(v3, v1) * v1[i] - dotProduct(v3, v2) * v2[i]);
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
        this.C0 = C0;
    }

    computeRegularizedPCA(returns, sectorLabels, CFull) {
        const nUs = Object.keys(sectorLabels).filter(k => k.startsWith('US_')).length;
        const nJp = Object.keys(sectorLabels).filter(k => k.startsWith('JP_')).length;
        if (this.C0 === null) this.buildPriorSpace(nUs, nJp, sectorLabels, CFull);

        const CT = correlationMatrix(returns);
        const N = CT.length;
        const lambda = this.config.lambdaReg;
        const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0));
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                CReg[i][j] = (1 - lambda) * CT[i][j] + lambda * this.C0[i][j];
            }
        }

        const { eigenvalues, eigenvectors } = eigenDecomposition(CReg, this.config.nFactors);
        return { VK: transpose(eigenvectors), eigenvalues };
    }
}

// ============================================================================
// シグナル生成
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

        const returnsStd = returnsCombined.map(row => row.map((x, j) => (x - mu[j]) / sigma[j]));
        const { VK } = this.pca.computeRegularizedPCA(returnsStd, sectorLabels, CFull);

        const VUs = VK.slice(0, nUs);
        const VJp = VK.slice(nUs);
        const zUsLatest = returnsUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        const fT = VUs.map(v => dotProduct(v, zUsLatest));
        return VJp.map(v => dotProduct(v, fT));
    }
}

// PCA PLAIN（λ=0）用
class PlainPCASignal {
    constructor(config) { 
        this.config = config; 
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

        const returnsStd = returnsCombined.map(row => row.map((x, j) => (x - mu[j]) / sigma[j]));
        const CT = correlationMatrix(returnsStd);
        const { eigenvalues, eigenvectors } = eigenDecomposition(CT, this.config.nFactors);
        const VK = transpose(eigenvectors);

        const VUs = VK.slice(0, nUs);
        const VJp = VK.slice(nUs);
        const zUsLatest = returnsUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        const fT = VUs.map(v => dotProduct(v, zUsLatest));
        return VJp.map(v => dotProduct(v, fT));
    }
}

// ============================================================================
// ポートフォリオ構築
// ============================================================================

/**
 * シグナル閾値フィルタ付きポートフォリオ構築
 * @param {number[]} signal - シグナル値
 * @param {number} quantile - 分位点
 * @param {number} threshold - 閾値（0 の場合は無効）
 */
function buildPortfolio(signal, quantile = 0.3, threshold = 0) {
    const n = signal.length;
    const q = Math.max(1, Math.floor(n * quantile));
    const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
    
    // 閾値フィルタリング（新規機能）
    let longIdx, shortIdx;
    if (threshold > 0) {
        // 信号の中央値を計算
        const absSignals = signal.map(Math.abs);
        const median = [...absSignals].sort((a, b) => a - b)[Math.floor(n / 2)];
        const effectiveThreshold = median * threshold;
        
        // 閾値を超える銘柄のみを選択
        longIdx = indexed.slice(-q).filter(x => Math.abs(x.val) > effectiveThreshold).map(x => x.idx);
        shortIdx = indexed.slice(0, q).filter(x => Math.abs(x.val) > effectiveThreshold).map(x => x.idx);
        
        // 銘柄が少なすぎる場合は閾値を緩和
        if (longIdx.length < 1) longIdx = indexed.slice(-q).map(x => x.idx);
        if (shortIdx.length < 1) shortIdx = indexed.slice(0, q).map(x => x.idx);
    } else {
        longIdx = indexed.slice(-q).map(x => x.idx);
        shortIdx = indexed.slice(0, q).map(x => x.idx);
    }
    
    const weights = new Array(n).fill(0);
    const w = 1.0 / Math.max(1, longIdx.length);
    for (const idx of longIdx) weights[idx] = w;
    for (const idx of shortIdx) weights[idx] = -w;
    return weights;
}

// DOUBLE ソート（モメンタム×PCA）
function buildDoubleSortPortfolio(momentumSignal, pcaSignal, quantile = 0.3) {
    const n = momentumSignal.length;
    const q = Math.max(1, Math.floor(n * quantile));
    
    // モメンタムでソート
    const momentumRanked = momentumSignal.map((val, idx) => ({ val, idx }))
        .sort((a, b) => a.val - b.val);
    
    // PCA でソート
    const pcaRanked = pcaSignal.map((val, idx) => ({ val, idx }))
        .sort((a, b) => a.val - b.val);
    
    // 両方のランキングを組み合わせ（平均ランク）
    const rankMap = new Map();
    for (let i = 0; i < n; i++) {
        const momIdx = momentumRanked[i].idx;
        const pcaIdx = pcaRanked[i].idx;
        if (!rankMap.has(momIdx)) rankMap.set(momIdx, 0);
        if (!rankMap.has(pcaIdx)) rankMap.set(pcaIdx, 0);
        rankMap.set(momIdx, rankMap.get(momIdx) + i);
        rankMap.set(pcaIdx, rankMap.get(pcaIdx) + i);
    }
    
    const combinedRank = Array.from(rankMap.entries())
        .map(([idx, rank]) => ({ idx, rank }))
        .sort((a, b) => a.rank - b.rank);
    
    const longIdx = combinedRank.slice(-q).map(x => x.idx);
    const shortIdx = combinedRank.slice(0, q).map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    for (const idx of longIdx) weights[idx] = 1.0 / q;
    for (const idx of shortIdx) weights[idx] = -1.0 / q;
    return weights;
}

// 単純平均（Equal Weight）
function buildEqualWeightPortfolio(n, longIndices, shortIndices) {
    const weights = new Array(n).fill(0);
    const w = 1.0 / longIndices.length;
    for (const idx of longIndices) weights[idx] = w;
    for (const idx of shortIndices) weights[idx] = -w;
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

// 年別パフォーマンス
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

// ローリングウィンドウ分析
function computeRollingMetrics(returns, window = 252) {
    const rollingMetrics = [];
    
    for (let i = window; i <= returns.length; i++) {
        const windowReturns = returns.slice(i - window, i);
        const metrics = computePerformanceMetrics(windowReturns);
        rollingMetrics.push({
            endIndex: i,
            date: returns[i - 1]?.date || `Day ${i}`,
            RR: metrics.RR,
            AR: metrics.AR,
            MDD: metrics.MDD
        });
    }
    
    return rollingMetrics;
}

// 取引コスト適用
function applyTransactionCosts(ret, costs) {
    const totalCost = costs.slippage + costs.commission;
    // ポートフォリオのターンオーバーを考慮（簡易的に 2 倍）
    return ret - totalCost * 2;
}

// ============================================================================
// データ処理
// ============================================================================

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

function buildReturnMatrices(usData, jpData) {
    const usTickers = Object.keys(usData);
    const jpTickers = Object.keys(jpData);

    const usCCReturns = {};
    const jpCCReturns = {};
    const jpOCReturns = {};

    for (const t of usTickers) usCCReturns[t] = computeCCReturns(usData[t]);
    for (const t of jpTickers) {
        jpCCReturns[t] = computeCCReturns(jpData[t]);
        jpOCReturns[t] = computeOCReturns(jpData[t]);
    }

    // 日付マップ
    const usCCMap = new Map();
    for (const t in usCCReturns) {
        for (const r of usCCReturns[t]) {
            if (!usCCMap.has(r.date)) usCCMap.set(r.date, {});
            usCCMap.get(r.date)[t] = r.return;
        }
    }

    const jpCCMap = new Map();
    const jpOCMap = new Map();
    for (const t in jpCCReturns) {
        for (const r of jpCCReturns[t]) {
            if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
            jpCCMap.get(r.date)[t] = r.return;
        }
        for (const r of jpOCReturns[t]) {
            if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
            jpOCMap.get(r.date)[t] = r.return;
        }
    }

    const usDates = new Set([...usCCMap.keys()].sort());
    const jpDates = new Set([...jpCCMap.keys()].sort());
    const commonDates = [...usDates].filter(d => jpDates.has(d)).sort();

    const returnsUs = [], returnsJp = [], returnsJpOc = [], dates = [];

    for (let i = 1; i < commonDates.length; i++) {
        const usDate = commonDates[i - 1];
        const jpDate = commonDates[i];

        const usRow = usTickers.map(t => usCCMap.get(usDate)?.[t] ?? null);
        const jpRow = jpTickers.map(t => jpCCMap.get(jpDate)?.[t] ?? null);
        const jpOcRow = jpTickers.map(t => jpOCMap.get(jpDate)?.[t] ?? null);

        if (usRow.some(v => v === null) || jpRow.some(v => v === null) || jpOcRow.some(v => v === null)) continue;

        returnsUs.push({ date: usDate, values: usRow });
        returnsJp.push({ date: jpDate, values: jpRow });
        returnsJpOc.push({ date: jpDate, values: jpOcRow });
        dates.push(jpDate);
    }

    return { returnsUs, returnsJp, returnsJpOc, dates };
}

// ============================================================================
// バックテスト実行
// ============================================================================

function runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull, strategy = 'PCA_SUB') {
    const nJp = returnsJp[0].values.length;
    const strategyReturns = [];
    const dates = [];
    
    const signalGenerator = strategy === 'PCA_PLAIN' 
        ? new PlainPCASignal(config)
        : new LeadLagSignal(config);

    for (let i = config.warmupPeriod; i < returnsJpOc.length; i++) {
        const windowStart = i - config.windowLength;
        const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
        const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
        const retUsLatest = returnsUs[i - 1].values;

        let weights;
        
        if (strategy === 'DOUBLE_SORT') {
            // DOUBLE ソート：モメンタムと PCA を組み合わせ
            const momentum = new Array(nJp).fill(0);
            for (let j = i - config.windowLength; j < i; j++) {
                for (let k = 0; k < nJp; k++) momentum[k] += returnsJp[j].values[k];
            }
            for (let k = 0; k < nJp; k++) momentum[k] /= config.windowLength;
            
            const pcaSignal = signalGenerator.computeSignal(retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull);
            weights = buildDoubleSortPortfolio(momentum, pcaSignal, config.quantile);
        } else if (strategy === 'EQUAL_WEIGHT') {
            // 単純平均：ロング 50%、ショート 50%
            const half = Math.floor(nJp / 2);
            const longIndices = Array.from({ length: half }, (_, i) => i);
            const shortIndices = Array.from({ length: half }, (_, i) => half + i);
            weights = buildEqualWeightPortfolio(nJp, longIndices, shortIndices);
        } else {
            // PCA ベース戦略
            const signal = signalGenerator.computeSignal(retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull);
            weights = buildPortfolio(signal, config.quantile, config.signalThreshold || 0);
        }
        
        const retNext = returnsJpOc[i].values;

        let strategyRet = 0;
        for (let j = 0; j < nJp; j++) strategyRet += weights[j] * retNext[j];
        
        // 取引コスト適用
        strategyRet = applyTransactionCosts(strategyRet, config.transactionCosts);
        
        strategyReturns.push({ date: returnsJpOc[i].date, return: strategyRet });
        dates.push(returnsJpOc[i].date);
    }

    return { returns: strategyReturns, dates };
}

function runMomentumStrategy(returnsJp, returnsJpOc, window = 60, quantile = 0.3, transactionCosts) {
    const nJp = returnsJp[0].values.length;
    const strategyReturns = [];
    const dates = [];

    for (let i = window; i < returnsJpOc.length; i++) {
        const momentum = new Array(nJp).fill(0);
        for (let j = i - window; j < i; j++) {
            for (let k = 0; k < nJp; k++) momentum[k] += returnsJp[j].values[k];
        }
        for (let k = 0; k < nJp; k++) momentum[k] /= window;

        const weights = buildPortfolio(momentum, quantile);
        const retNext = returnsJpOc[i].values;

        let strategyRet = 0;
        for (let j = 0; j < nJp; j++) strategyRet += weights[j] * retNext[j];
        
        // 取引コスト適用
        strategyRet = applyTransactionCosts(strategyRet, transactionCosts);
        
        strategyReturns.push({ date: returnsJpOc[i].date, return: strategyRet });
        dates.push(returnsJpOc[i].date);
    }

    return { returns: strategyReturns, dates };
}

function computeCFull(returnsUs, returnsJp) {
    const combined = [];
    for (let i = 0; i < Math.min(returnsUs.length, returnsJp.length); i++) {
        combined.push([...returnsUs[i].values, ...returnsJp[i].values]);
    }
    return correlationMatrix(combined);
}

// ============================================================================
// グリッドサーチ
// ============================================================================

function runGridSearch(returnsUs, returnsJp, returnsJpOc, sectorLabels, CFull) {
    console.log('\n' + '='.repeat(60));
    console.log('パラメータ最適化（グリッドサーチ）');
    console.log('='.repeat(60));
    
    const { lambdaReg, windowLength, nFactors, quantile } = CONFIG.gridSearch;
    let bestParams = null;
    let bestRR = -Infinity;
    const results = [];
    
    const totalCombos = lambdaReg.length * windowLength.length * nFactors.length * quantile.length;
    let comboCount = 0;
    
    for (const lambda of lambdaReg) {
        for (const window of windowLength) {
            for (const factors of nFactors) {
                for (const q of quantile) {
                    comboCount++;
                    const config = {
                        ...CONFIG,
                        lambdaReg: lambda,
                        windowLength: window,
                        nFactors: factors,
                        quantile: q,
                        warmupPeriod: window
                    };
                    
                    const result = runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull, 'PCA_SUB');
                    const metrics = computePerformanceMetrics(result.returns.map(r => r.return));
                    
                    results.push({
                        lambdaReg: lambda,
                        windowLength: window,
                        nFactors: factors,
                        quantile: q,
                        AR: metrics.AR,
                        RISK: metrics.RISK,
                        RR: metrics.RR,
                        MDD: metrics.MDD
                    });
                    
                    if (metrics.RR > bestRR) {
                        bestRR = metrics.RR;
                        bestParams = { lambda, window, factors, q, metrics };
                    }
                    
                    if (comboCount % 20 === 0) {
                        console.log(`  進行状況：${comboCount}/${totalCombos}`);
                    }
                }
            }
        }
    }
    
    console.log('\n[最適パラメータ]');
    console.log(`  lambda_reg: ${bestParams.lambda}`);
    console.log(`  window_length: ${bestParams.window}`);
    console.log(`  n_factors: ${bestParams.factors}`);
    console.log(`  quantile: ${bestParams.q}`);
    console.log(`\n[最適パラメータでのパフォーマンス]`);
    console.log(`  AR: ${(bestParams.metrics.AR * 100).toFixed(2)}%`);
    console.log(`  RISK: ${(bestParams.metrics.RISK * 100).toFixed(2)}%`);
    console.log(`  R/R: ${bestParams.metrics.RR.toFixed(2)}`);
    console.log(`  MDD: ${(bestParams.metrics.MDD * 100).toFixed(2)}%`);
    
    return { bestParams, gridResults: results };
}

// ============================================================================
// 結果出力
// ============================================================================

function saveResults(outputDir, strategies, gridResults, yearlyMetrics, rollingMetrics) {
    // 戦略比較サマリー
    const summaryCSV = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Cumulative\n' +
        strategies.map(s => 
            `${s.name},${(s.metrics.AR * 100).toFixed(4)},${(s.metrics.RISK * 100).toFixed(4)},${s.metrics.RR.toFixed(4)},${(s.metrics.MDD * 100).toFixed(4)},${s.metrics.Cumulative.toFixed(4)}`
        ).join('\n');
    fs.writeFileSync(path.join(outputDir, 'backtest_summary.csv'), summaryCSV);
    console.log(`  保存：backtest_summary.csv`);
    
    // グリッドサーチ結果
    const gridCSV = 'lambda_reg,window_length,n_factors,quantile,AR (%),RISK (%),R/R,MDD (%)\n' +
        gridResults.map(r => 
            `${r.lambdaReg},${r.windowLength},${r.nFactors},${r.quantile},${(r.AR * 100).toFixed(4)},${(r.RISK * 100).toFixed(4)},${r.RR.toFixed(4)},${(r.MDD * 100).toFixed(4)}`
        ).join('\n');
    fs.writeFileSync(path.join(outputDir, 'grid_search_results.csv'), gridCSV);
    console.log(`  保存：grid_search_results.csv`);
    
    // 年別パフォーマンス
    const yearlyCSV = 'Strategy,Year,AR (%),RISK (%),R/R,MDD (%)\n' +
        Object.entries(yearlyMetrics).flatMap(([strategy, years]) =>
            Object.entries(years).map(([year, m]) =>
                `${strategy},${year},${(m.AR * 100).toFixed(4)},${(m.RISK * 100).toFixed(4)},${m.RR.toFixed(4)},${(m.MDD * 100).toFixed(4)}`
            )
        ).join('\n');
    fs.writeFileSync(path.join(outputDir, 'yearly_performance.csv'), yearlyCSV);
    console.log(`  保存：yearly_performance.csv`);
    
    // 累積リターン（各戦略）
    for (const strategy of strategies) {
        const cumulativeCSV = 'Date,Cumulative\n' +
            strategy.results.returns.map((r, i) => 
                `${r.date},${strategy.metrics.CumulativeReturns[i].toFixed(6)}`
            ).join('\n');
        fs.writeFileSync(path.join(outputDir, `cumulative_${strategy.name.toLowerCase().replace(/\s+/g, '_')}.csv`), cumulativeCSV);
    }
    console.log(`  保存：cumulative_*.csv (各戦略)`);
    
    // ローリングウィンドウ分析
    for (const strategy of strategies) {
        if (rollingMetrics[strategy.name]) {
            const rollingCSV = 'Date,RR,AR (%),MDD (%)\n' +
                rollingMetrics[strategy.name].map(r =>
                    `${r.date},${r.RR.toFixed(4)},${(r.AR * 100).toFixed(4)},${(r.MDD * 100).toFixed(4)}`
                ).join('\n');
            fs.writeFileSync(path.join(outputDir, `rolling_${strategy.name.toLowerCase().replace(/\s+/g, '_')}.csv`), rollingCSV);
        }
    }
    console.log(`  保存：rolling_*.csv (各戦略)`);
}

// ============================================================================
// メイン
// ============================================================================

async function main() {
    console.log('='.repeat(60));
    console.log('日米業種リードラグ戦略 - 包括的バックテストシステム v2.0');
    console.log('='.repeat(60));
    
    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    // データ取得/読み込み
    console.log('\n[1/6] データ取得/読み込み...');
    
    let usData, jpData;
    const useLocalData = fs.existsSync(path.join(dataDir, 'XLB.csv'));
    
    if (useLocalData) {
        console.log('ローカルデータを使用します...');
        usData = loadLocalData(dataDir, US_ETF_TICKERS);
        jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
    } else {
        console.log('Yahoo Finance からデータを取得します...');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        usData = await fetchAllData(US_ETF_TICKERS);
        jpData = await fetchAllData(JP_ETF_TICKERS);
        
        // データ保存
        console.log('\n[2/6] データを保存中...');
        for (const ticker in usData) {
            const csv = 'Date,Open,High,Low,Close,Volume\n' +
                usData[ticker].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
            fs.writeFileSync(path.join(dataDir, `${ticker}.csv`), csv);
        }
        for (const ticker in jpData) {
            const csv = 'Date,Open,High,Low,Close,Volume\n' +
                jpData[ticker].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
            fs.writeFileSync(path.join(dataDir, `${ticker}.csv`), csv);
        }
    }
    
    // データ処理
    console.log('\n[3/6] データ処理中...');
    const { returnsUs, returnsJp, returnsJpOc, dates } = buildReturnMatrices(usData, jpData);
    
    console.log(`  共通取引日数：${dates.length}`);
    console.log(`  期間：${dates[0]} ~ ${dates[dates.length - 1]}`);
    
    if (dates.length < CONFIG.warmupPeriod + 10) {
        console.error('エラー：データが不足しています');
        return;
    }
    
    // C_full 計算
    const CFull = computeCFull(returnsUs, returnsJp);
    
    // グリッドサーチ（パラメータ最適化）
    console.log('\n[4/6] パラメータ最適化実行中...');
    const { bestParams, gridResults } = runGridSearch(returnsUs, returnsJp, returnsJpOc, SECTOR_LABELS, CFull);
    
    // 最適パラメータで全戦略を実行
    console.log('\n[5/6] 各戦略のバックテスト実行中...');
    
    const optimalConfig = {
        ...CONFIG,
        lambdaReg: bestParams.lambda,
        windowLength: bestParams.window,
        nFactors: bestParams.factors,
        quantile: bestParams.q,
        warmupPeriod: bestParams.window
    };
    
    const strategies = [];
    const yearlyMetrics = {};
    const rollingMetrics = {};
    
    // 戦略 1: PCA SUB
    console.log('\n  戦略 1: PCA SUB（部分空間正則化付き PCA）');
    const resultSub = runBacktest(returnsUs, returnsJp, returnsJpOc, optimalConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
    const metricsSub = computePerformanceMetrics(resultSub.returns.map(r => r.return));
    console.log(`    AR: ${(metricsSub.AR * 100).toFixed(2)}%, R/R: ${metricsSub.RR.toFixed(2)}, MDD: ${(metricsSub.MDD * 100).toFixed(2)}%`);
    strategies.push({ name: 'PCA_SUB', results: resultSub, metrics: metricsSub });
    yearlyMetrics['PCA_SUB'] = computeYearlyPerformance(resultSub.returns);
    rollingMetrics['PCA_SUB'] = computeRollingMetrics(resultSub.returns.map(r => r.return), CONFIG.rollingWindow);
    
    // 戦略 2: PCA PLAIN
    console.log('\n  戦略 2: PCA PLAIN（λ=0）');
    const resultPlain = runBacktest(returnsUs, returnsJp, returnsJpOc, optimalConfig, SECTOR_LABELS, CFull, 'PCA_PLAIN');
    const metricsPlain = computePerformanceMetrics(resultPlain.returns.map(r => r.return));
    console.log(`    AR: ${(metricsPlain.AR * 100).toFixed(2)}%, R/R: ${metricsPlain.RR.toFixed(2)}, MDD: ${(metricsPlain.MDD * 100).toFixed(2)}%`);
    strategies.push({ name: 'PCA_PLAIN', results: resultPlain, metrics: metricsPlain });
    yearlyMetrics['PCA_PLAIN'] = computeYearlyPerformance(resultPlain.returns);
    rollingMetrics['PCA_PLAIN'] = computeRollingMetrics(resultPlain.returns.map(r => r.return), CONFIG.rollingWindow);
    
    // 戦略 3: DOUBLE SORT
    console.log('\n  戦略 3: DOUBLE SORT（モメンタム×PCA）');
    const resultDouble = runBacktest(returnsUs, returnsJp, returnsJpOc, optimalConfig, SECTOR_LABELS, CFull, 'DOUBLE_SORT');
    const metricsDouble = computePerformanceMetrics(resultDouble.returns.map(r => r.return));
    console.log(`    AR: ${(metricsDouble.AR * 100).toFixed(2)}%, R/R: ${metricsDouble.RR.toFixed(2)}, MDD: ${(metricsDouble.MDD * 100).toFixed(2)}%`);
    strategies.push({ name: 'DOUBLE_SORT', results: resultDouble, metrics: metricsDouble });
    yearlyMetrics['DOUBLE_SORT'] = computeYearlyPerformance(resultDouble.returns);
    rollingMetrics['DOUBLE_SORT'] = computeRollingMetrics(resultDouble.returns.map(r => r.return), CONFIG.rollingWindow);
    
    // 戦略 4: EQUAL WEIGHT
    console.log('\n  戦略 4: EQUAL WEIGHT（単純平均）');
    const resultEqual = runBacktest(returnsUs, returnsJp, returnsJpOc, optimalConfig, SECTOR_LABELS, CFull, 'EQUAL_WEIGHT');
    const metricsEqual = computePerformanceMetrics(resultEqual.returns.map(r => r.return));
    console.log(`    AR: ${(metricsEqual.AR * 100).toFixed(2)}%, R/R: ${metricsEqual.RR.toFixed(2)}, MDD: ${(metricsEqual.MDD * 100).toFixed(2)}%`);
    strategies.push({ name: 'EQUAL_WEIGHT', results: resultEqual, metrics: metricsEqual });
    yearlyMetrics['EQUAL_WEIGHT'] = computeYearlyPerformance(resultEqual.returns);
    rollingMetrics['EQUAL_WEIGHT'] = computeRollingMetrics(resultEqual.returns.map(r => r.return), CONFIG.rollingWindow);
    
    // 戦略 5: MOMENTUM
    console.log('\n  戦略 5: MOMENTUM（単純モメンタム）');
    const resultMom = runMomentumStrategy(returnsJp, returnsJpOc, optimalConfig.windowLength, optimalConfig.quantile, CONFIG.transactionCosts);
    const metricsMom = computePerformanceMetrics(resultMom.returns.map(r => r.return));
    console.log(`    AR: ${(metricsMom.AR * 100).toFixed(2)}%, R/R: ${metricsMom.RR.toFixed(2)}, MDD: ${(metricsMom.MDD * 100).toFixed(2)}%`);
    strategies.push({ name: 'MOMENTUM', results: resultMom, metrics: metricsMom });
    yearlyMetrics['MOMENTUM'] = computeYearlyPerformance(resultMom.returns);
    rollingMetrics['MOMENTUM'] = computeRollingMetrics(resultMom.returns.map(r => r.return), CONFIG.rollingWindow);
    
    // 結果出力
    console.log('\n[6/6] 結果を保存中...');
    saveResults(outputDir, strategies, gridResults, yearlyMetrics, rollingMetrics);
    
    // 戦略比較サマリー表示
    console.log('\n' + '='.repeat(80));
    console.log('戦略比較サマリー（取引コスト込み：スリッページ 0.1% + 手数料 0.05%）');
    console.log('='.repeat(80));
    console.log('Strategy'.padEnd(15) + 'AR (%)'.padStart(10) + 'RISK (%)'.padStart(12) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(12) + 'Cumulative'.padStart(12));
    console.log('-'.repeat(80));
    for (const s of strategies) {
        console.log(
            s.name.padEnd(15) +
            (s.metrics.AR * 100).toFixed(2).padStart(10) +
            (s.metrics.RISK * 100).toFixed(2).padStart(12) +
            s.metrics.RR.toFixed(2).padStart(10) +
            (s.metrics.MDD * 100).toFixed(2).padStart(12) +
            s.metrics.Cumulative.toFixed(4).padStart(12)
        );
    }
    
    // 年別パフォーマンス表示
    console.log('\n' + '='.repeat(80));
    console.log('年別パフォーマンス（R/R）');
    console.log('='.repeat(80));
    
    const years = Object.keys(yearlyMetrics['PCA_SUB']).sort();
    const header = 'Year'.padEnd(8) + strategies.map(s => s.name.padEnd(15)).join('');
    console.log(header);
    console.log('-'.repeat(80));
    
    for (const year of years) {
        let row = year.padEnd(8);
        for (const s of strategies) {
            const m = yearlyMetrics[s.name][year];
            row += (m ? m.RR.toFixed(2).padStart(15) : 'N/A'.padStart(15));
        }
        console.log(row);
    }
    
    // 改善提言
    console.log('\n' + '='.repeat(80));
    console.log('改善提言');
    console.log('='.repeat(80));
    
    const bestStrategy = strategies.reduce((a, b) => a.metrics.RR > b.metrics.RR ? a : b);
    const worstStrategy = strategies.reduce((a, b) => a.metrics.RR < b.metrics.RR ? a : b);
    
    console.log(`\n1. 最適戦略：${bestStrategy.name}`);
    console.log(`   - R/R: ${bestStrategy.metrics.RR.toFixed(2)}, AR: ${(bestStrategy.metrics.AR * 100).toFixed(2)}%, MDD: ${(bestStrategy.metrics.MDD * 100).toFixed(2)}%`);
    
    console.log(`\n2. パラメータ感応性:`);
    const topParams = gridResults.sort((a, b) => b.RR - a.RR).slice(0, 5);
    console.log('   トップ 5 パラメータ組合せ:');
    topParams.forEach((p, i) => {
        console.log(`   ${i + 1}. λ=${p.lambdaReg}, window=${p.windowLength}, factors=${p.nFactors}, quantile=${p.quantile} → R/R=${p.RR.toFixed(2)}`);
    });
    
    console.log(`\n3. 取引コストの影響:`);
    const totalCostRate = (CONFIG.transactionCosts.slippage + CONFIG.transactionCosts.commission) * 2;
    console.log(`   - 1 取引あたりのコスト：${(totalCostRate * 100).toFixed(3)}%`);
    console.log(`   - 年換算（252 日）：${(totalCostRate * 252 * 100).toFixed(2)}%`);
    
    console.log(`\n4. 追加改善の方向性:`);
    console.log('   - リスク管理：ボラティリティ調整ポジションサイジング');
    console.log('   - 市場環境適応：レジームスイッチングモデルの導入');
    console.log('   - 取引頻度最適化：シグナル閾値の動的調整');
    console.log('   - 相関構造変化：時間変動相関モデルの適用');
    
    console.log('\n' + '='.repeat(80));
    console.log('バックテスト完了');
    console.log('='.repeat(80));

    // [新規] 複数パラメータ即時比較
    console.log('\n' + '='.repeat(80));
    console.log('パラメータ比較（シグナル閾値効果）');
    console.log('='.repeat(80));
    
    const testConfigs = [
        { name: 'Base', lambda: 0.9, window: 60, q: 0.4, factors: 3, threshold: 0 },
        { name: 'HighReg', lambda: 0.95, window: 60, q: 0.35, factors: 3, threshold: 0 },
        { name: 'Thresh30', lambda: 0.9, window: 60, q: 0.4, factors: 3, threshold: 0.3 },
        { name: 'Thresh50', lambda: 0.9, window: 60, q: 0.4, factors: 3, threshold: 0.5 },
    ];
    
    console.log('\nパラメータ比較テスト...\n');
    const paramResults = [];
    for (const cfg of testConfigs) {
        const testConfig = { ...CONFIG, lambdaReg: cfg.lambda, windowLength: cfg.window, quantile: cfg.q, nFactors: cfg.factors, signalThreshold: cfg.threshold, warmupPeriod: cfg.window };
        const result = runBacktest(returnsUs, returnsJp, returnsJpOc, testConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
        const metrics = computePerformanceMetrics(result.returns.map(r => r.return));
        paramResults.push({ name: cfg.name, metrics, config: cfg });
        console.log(`${cfg.name.padEnd(10)}: AR=${(metrics.AR*100).toFixed(2)}%, R/R=${metrics.RR.toFixed(2)}, MDD=${(metrics.MDD*100).toFixed(2)}%, Cum=${((metrics.Cumulative-1)*100).toFixed(2)}%`);
    }
    
    const bestParam = paramResults.reduce((a, b) => a.metrics.RR > b.metrics.RR ? a : b);
    console.log(`\n最佳パラメータ：${bestParam.name}`);
    console.log(`λ=${bestParam.config.lambda}, window=${bestParam.config.window}, q=${bestParam.config.q}, threshold=${bestParam.config.threshold}`);
}

main().catch(console.error);
