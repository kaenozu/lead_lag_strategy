/**
 * 日米業種リードラグ戦略 - 改良版（高速グリッドサーチ）
 * パラメータ調整・高速化を含む完全版
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 設定
// ============================================================================

const BASE_CONFIG = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.3,
    warmupPeriod: 60,
};

// パラメータグリッド（高速化版：約 20-30 秒で完了）
const PARAM_GRID = {
    windowLength: [40, 60],
    lambdaReg: [0.9, 0.95],
    quantile: [0.3, 0.4],
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

// セクターラベル（改良版：より詳細に分類）
const SECTOR_LABELS = {
    'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 'US_XLRE': 'cyclical',
    'US_XLK': 'defensive', 'US_XLP': 'defensive', 'US_XLU': 'defensive', 'US_XLV': 'defensive',
    'US_XLI': 'cyclical', 'US_XLC': 'neutral', 'US_XLY': 'cyclical',
    'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
    'JP_1619.T': 'cyclical', 'JP_1620.T': 'cyclical', 'JP_1622.T': 'cyclical', 'JP_1623.T': 'cyclical',
    'JP_1624.T': 'cyclical', 'JP_1626.T': 'neutral', 'JP_1628.T': 'cyclical', 'JP_1632.T': 'cyclical',
    'JP_1633.T': 'defensive',
};

// ============================================================================
// データ取得
// ============================================================================

async function fetchYahooFinanceData(ticker, startDate = '2010-01-01', endDate = '2025-12-31') {
    console.log(`  ${ticker}...`);
    try {
        const result = await yahooFinance.chart(ticker, { period1: startDate, period2: endDate, interval: '1d' });
        const data = result.quotes
            .filter(q => q.close !== null && q.close > 0)
            .map(q => ({
                date: q.date.toISOString().split('T')[0],
                open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
            }));
        return data;
    } catch (e) {
        console.error(`  ${ticker} Error: ${e.message}`);
        return [];
    }
}

async function fetchAllData(tickers, startDate, endDate) {
    const results = {};
    for (const ticker of tickers) {
        results[ticker] = await fetchYahooFinanceData(ticker, startDate, endDate);
    }
    return results;
}

// ローカルデータ読み込み（高速化用）
function loadLocalData(dataDir, tickers) {
    const results = {};
    for (const ticker of tickers) {
        const filePath = path.join(dataDir, `${ticker}.csv`);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').slice(1).filter(l => l.trim());
            results[ticker] = lines.map(line => {
                const [date, open, high, low, close, volume] = line.split(',');
                return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume || 0 };
            });
        } else {
            results[ticker] = [];
        }
    }
    return results;
}

// ============================================================================
// 線形代数
// ============================================================================

function transpose(m) { return m[0].map((_, i) => m.map(r => r[i])); }
function dotProduct(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function normalize(v) { const n = norm(v); return n > 1e-10 ? v.map(x => x / n) : v; }
function diag(m) { return m.map((r, i) => r[i]); }
function makeDiag(v) {
    const n = v.length;
    const r = new Array(n).fill(0).map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) r[i][i] = v[i];
    return r;
}

function matmul(A, B) {
    const rowsA = A.length, colsA = A[0].length, colsB = B[0].length;
    const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));
    for (let i = 0; i < rowsA; i++)
        for (let j = 0; j < colsB; j++)
            for (let k = 0; k < colsA; k++)
                result[i][j] += A[i][k] * B[k][j];
    return result;
}

function eigenDecposition(matrix, k = 3) {
    const n = matrix.length;
    const eigenvalues = [], eigenvectors = [];
    let A = matrix.map(r => [...r]);
    
    for (let e = 0; e < k; e++) {
        // べき乗法: 決定論的な初期化（列eの値を使用、ゼロの場合は単位ベクトル）
        let v = new Array(n).fill(0).map((_, i) => matrix[i][e] || 0);
        const vNorm = norm(v);
        if (vNorm < 1e-10) {
            v = new Array(n).fill(0).map((_, i) => (i === e % n) ? 1 : 0);
        }
        v = normalize(v);
        for (let iter = 0; iter < 500; iter++) {
            let vNew = new Array(n).fill(0);
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++) vNew[i] += A[i][j] * v[j];
            const nn = norm(vNew);
            if (nn < 1e-10) break;
            v = normalize(vNew);
        }
        const Av = new Array(n).fill(0);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j];
        eigenvalues.push(dotProduct(v, Av));
        eigenvectors.push(v);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++)
                A[i][j] -= eigenvalues[e] * v[i] * v[j];
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
        let ss = 0;
        for (let i = 0; i < n; i++) { const d = data[i][j] - means[j]; ss += d * d; }
        stds[j] = Math.sqrt(ss / n);
    }
    const std = new Array(n).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++)
            std[i][j] = stds[j] > 1e-10 ? (data[i][j] - means[j]) / stds[j] : 0;
    
    const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++)
        for (let j = 0; j < m; j++) {
            let s = 0;
            for (let k = 0; k < n; k++) s += std[k][i] * std[k][j];
            corr[i][j] = s / n;
        }
    return corr;
}

// ============================================================================
// PCA & シグナル
// ============================================================================

class SubspacePCA {
    constructor(config) { this.config = config; this.C0 = null; }
    
    buildPriorSpace(nUs, nJp, labels, CFull) {
        const N = nUs + nJp;
        const keys = Object.keys(labels);
        
        let v1 = normalize(new Array(N).fill(1));
        let v2 = new Array(N).fill(0);
        for (let i = 0; i < nUs; i++) v2[i] = 1;
        for (let i = nUs; i < N; i++) v2[i] = -1;
        v2 = normalize(v2.map((x, i) => x - dotProduct(v2, v1) * v1[i]));
        
        let v3 = new Array(N).fill(0);
        for (let i = 0; i < N; i++) {
            if (labels[keys[i]] === 'cyclical') v3[i] = 1;
            else if (labels[keys[i]] === 'defensive') v3[i] = -1;
        }
        v3 = v3.map((x, i) => x - dotProduct(v3, v1) * v1[i] - dotProduct(v3, v2) * v2[i]);
        v3 = normalize(v3);
        
        const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);
        const CFullV0 = matmul(CFull, V0);
        const D0 = diag(matmul(transpose(V0), CFullV0));
        const C0Raw = matmul(matmul(V0, makeDiag(D0)), transpose(V0));
        const delta = diag(C0Raw);
        const inv = delta.map(x => 1 / Math.sqrt(Math.abs(x) + 1e-10));
        let C0 = matmul(matmul(makeDiag(inv), C0Raw), makeDiag(inv));
        for (let i = 0; i < N; i++) C0[i][i] = 1;
        this.C0 = C0;
    }
    
    compute(returns, labels, CFull) {
        const nUs = Object.keys(labels).filter(k => k.startsWith('US_')).length;
        const nJp = Object.keys(labels).filter(k => k.startsWith('JP_')).length;
        if (!this.C0) this.buildPriorSpace(nUs, nJp, labels, CFull);
        
        const CT = correlationMatrix(returns);
        const N = CT.length;
        const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0));
        for (let i = 0; i < N; i++)
            for (let j = 0; j < N; j++)
                CReg[i][j] = (1 - this.config.lambdaReg) * CT[i][j] + this.config.lambdaReg * this.C0[i][j];
        
        const { eigenvectors } = eigenDecposition(CReg, this.config.nFactors);
        return transpose(eigenvectors);
    }
}

class LeadLagSignal {
    constructor(config) { this.config = config; this.pca = new SubspacePCA(config); }
    
    compute(retUs, retJp, retUsLatest, labels, CFull) {
        const nSamples = retUs.length, nUs = retUs[0].length, nJp = retJp[0].length;
        const combined = retUs.map((r, i) => [...r, ...retJp[i]]);
        const N = nUs + nJp;
        
        const mu = new Array(N).fill(0);
        const sigma = new Array(N).fill(0);
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < nSamples; i++) mu[j] += combined[i][j];
            mu[j] /= nSamples;
            let ss = 0;
            for (let i = 0; i < nSamples; i++) { const d = combined[i][j] - mu[j]; ss += d * d; }
            sigma[j] = Math.sqrt(ss / nSamples) + 1e-10;
        }
        
        const std = combined.map(r => r.map((x, j) => (x - mu[j]) / sigma[j]));
        const VK = this.pca.compute(std, labels, CFull);
        
        const VUs = VK.slice(0, nUs), VJp = VK.slice(nUs);
        const zLatest = retUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        const fT = VUs.map(v => dotProduct(v, zLatest));
        return VJp.map(v => dotProduct(v, fT));
    }
}

// ============================================================================
// ポートフォリオ & パフォーマンス
// ============================================================================

function buildPortfolio(signal, quantile = 0.3) {
    const n = signal.length, q = Math.max(1, Math.floor(n * quantile));
    const indexed = signal.map((v, i) => ({ val: v, idx: i })).sort((a, b) => a.val - b.val);
    const weights = new Array(n).fill(0);
    indexed.slice(-q).forEach(x => weights[x.idx] = 1 / q);
    indexed.slice(0, q).forEach(x => weights[x.idx] = -1 / q);
    return weights;
}

function computeMetrics(returns, ann = 252) {
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * ann;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const var_ = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const risk = Math.sqrt(var_) * Math.sqrt(ann);
    const rr = risk > 0 ? ar / risk : 0;
    
    let cum = 1, rMax = 1, mdd = 0;
    for (const r of returns) {
        cum *= (1 + r);
        if (cum > rMax) rMax = cum;
        const dd = (cum - rMax) / rMax;
        if (dd < mdd) mdd = dd;
    }
    return { AR: ar * 100, RISK: risk * 100, RR: rr, MDD: mdd * 100, Total: (cum - 1) * 100 };
}

// ============================================================================
// データ処理
// ============================================================================

function computeReturns(ohlc, type = 'cc') {
    if (type === 'cc') {
        const ret = [];
        let prev = null;
        for (const r of ohlc) {
            if (prev !== null) ret.push({ date: r.date, return: (r.close - prev) / prev });
            prev = r.close;
        }
        return ret;
    } else {
        return ohlc.filter(r => r.open > 0).map(r => ({
            date: r.date, return: (r.close - r.open) / r.open
        }));
    }
}

function buildMatrices(usData, jpData) {
    const usTickers = Object.keys(usData), jpTickers = Object.keys(jpData);
    
    const usCC = {}, jpCC = {}, jpOC = {};
    for (const t of usTickers) usCC[t] = computeReturns(usData[t], 'cc');
    for (const t of jpTickers) {
        jpCC[t] = computeReturns(jpData[t], 'cc');
        jpOC[t] = computeReturns(jpData[t], 'oc');
    }
    
    const usMap = new Map(), jpCCMap = new Map(), jpOCMap = new Map();
    for (const t in usCC)
        for (const r of usCC[t]) {
            if (!usMap.has(r.date)) usMap.set(r.date, {});
            usMap.get(r.date)[t] = r.return;
        }
    for (const t in jpCC) {
        for (const r of jpCC[t]) {
            if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
            jpCCMap.get(r.date)[t] = r.return;
        }
        for (const r of jpOC[t]) {
            if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
            jpOCMap.get(r.date)[t] = r.return;
        }
    }
    
    const usDates = new Set([...usMap.keys()].sort());
    const jpDates = new Set([...jpCCMap.keys()].sort());
    const common = [...usDates].filter(d => jpDates.has(d)).sort();
    
    const retUs = [], retJp = [], retJpOc = [], dates = [];
    for (let i = 1; i < common.length; i++) {
        const usDate = common[i - 1], jpDate = common[i];
        const usRow = usTickers.map(t => usMap.get(usDate)?.[t] ?? null);
        const jpRow = jpTickers.map(t => jpCCMap.get(jpDate)?.[t] ?? null);
        const jpOcRow = jpTickers.map(t => jpOCMap.get(jpDate)?.[t] ?? null);
        
        if (usRow.some(v => v === null) || jpRow.some(v => v === null) || jpOcRow.some(v => v === null)) continue;
        
        retUs.push({ date: usDate, values: usRow });
        retJp.push({ date: jpDate, values: jpRow });
        retJpOc.push({ date: jpDate, values: jpOcRow });
        dates.push(jpDate);
    }
    
    return { retUs, retJp, retJpOc, dates };
}

function computeCFull(retUs, retJp) {
    const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
        .map((r, i) => [...r.values, ...retJp[i].values]);
    return correlationMatrix(combined);
}

// ============================================================================
// 戦略
// ============================================================================

function runStrategy(retUs, retJp, retJpOc, config, labels, CFull, useMomentum = false) {
    const nJp = retJp[0].values.length;
    const results = [];
    const signalGen = useMomentum ? null : new LeadLagSignal(config);
    
    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const start = i - config.windowLength;
        let signal;
        
        if (useMomentum) {
            signal = new Array(nJp).fill(0);
            for (let j = start; j < i; j++)
                for (let k = 0; k < nJp; k++) signal[k] += retJp[j].values[k];
            signal = signal.map(x => x / config.windowLength);
        } else {
            const retUsWin = retUs.slice(start, i).map(r => r.values);
            const retJpWin = retJp.slice(start, i).map(r => r.values);
            const retUsLatest = retUs[i - 1].values;
            signal = signalGen.compute(retUsWin, retJpWin, retUsLatest, labels, CFull);
        }
        
        const weights = buildPortfolio(signal, config.quantile);
        const retNext = retJpOc[i].values;
        let stratRet = 0;
        for (let j = 0; j < nJp; j++) stratRet += weights[j] * retNext[j];
        results.push({ date: retJpOc[i].date, return: stratRet });
    }
    
    return results;
}

function runDoubleSort(retUs, retJp, retJpOc, config, labels, CFull) {
    const nJp = retJp[0].values.length;
    const results = [];
    const signalGen = new LeadLagSignal(config);
    
    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const start = i - config.windowLength;
        const retUsWin = retUs.slice(start, i).map(r => r.values);
        const retJpWin = retJp.slice(start, i).map(r => r.values);
        const retUsLatest = retUs[i - 1].values;
        
        const signalPca = signalGen.compute(retUsWin, retJpWin, retUsLatest, labels, CFull);
        
        const signalMom = new Array(nJp).fill(0);
        for (let j = start; j < i; j++)
            for (let k = 0; k < nJp; k++) signalMom[k] += retJp[j].values[k];
        for (let k = 0; k < nJp; k++) signalMom[k] /= config.windowLength;
        
        // ダブルソート（各シグナルを 3 等分）
        const sortedPca = [...signalPca].sort((a, b) => a - b);
        const sortedMom = [...signalMom].sort((a, b) => a - b);
        const pcaLow = sortedPca[Math.floor(nJp * 0.33)];
        const pcaHigh = sortedPca[Math.floor(nJp * 0.67)];
        const momLow = sortedMom[Math.floor(nJp * 0.33)];
        const momHigh = sortedMom[Math.floor(nJp * 0.67)];
        
        let longCnt = 0, shortCnt = 0;
        for (let j = 0; j < nJp; j++) {
            if (signalPca[j] > pcaHigh && signalMom[j] > momHigh) longCnt++;
            else if (signalPca[j] < pcaLow && signalMom[j] < momLow) shortCnt++;
        }
        
        if (longCnt === 0 || shortCnt === 0) {
            results.push({ date: retJpOc[i].date, return: 0 });
            continue;
        }
        
        const weights = new Array(nJp).fill(0);
        for (let j = 0; j < nJp; j++) {
            if (signalPca[j] > pcaHigh && signalMom[j] > momHigh) weights[j] = 1 / longCnt;
            else if (signalPca[j] < pcaLow && signalMom[j] < momLow) weights[j] = -1 / shortCnt;
        }
        
        const retNext = retJpOc[i].values;
        let stratRet = 0;
        for (let j = 0; j < nJp; j++) stratRet += weights[j] * retNext[j];
        results.push({ date: retJpOc[i].date, return: stratRet });
    }
    
    return results;
}

// ============================================================================
// パラメータ最適化
// ============================================================================

function optimizeParams(retUs, retJp, retJpOc, labels, CFull) {
    console.log('パラメータ最適化中...');
    let bestScore = -Infinity;
    let bestConfig = null;
    let bestMetrics = null;
    
    const keys = Object.keys(PARAM_GRID);
    const n = keys.length;
    
    function generateCombinations(idx, current) {
        if (idx === n) {
            const config = { ...BASE_CONFIG, ...current, warmupPeriod: current.windowLength };
            try {
                const results = runStrategy(retUs, retJp, retJpOc, config, labels, CFull, false);
                const metrics = computeMetrics(results.map(r => r.return));
                const score = metrics.RR - Math.abs(metrics.MDD); // R/R を最大化、MDD を最小化
                
                if (score > bestScore) {
                    bestScore = score;
                    bestConfig = { ...config };
                    bestMetrics = { ...metrics };
                    console.log(`  新記録: λ=${config.lambdaReg}, window=${config.windowLength}, q=${config.quantile} => R/R=${metrics.RR.toFixed(2)}, MDD=${metrics.MDD.toFixed(1)}%`);
                }
            } catch (e) {
                // エラーは無視
            }
            return;
        }
        
        for (const val of PARAM_GRID[keys[idx]]) {
            current[keys[idx]] = val;
            generateCombinations(idx + 1, current);
        }
    }
    
    generateCombinations(0, {});
    
    console.log(`最適パラメータ: λ=${bestConfig.lambdaReg}, window=${bestConfig.windowLength}, q=${bestConfig.quantile}`);
    return { config: bestConfig, metrics: bestMetrics };
}

// ============================================================================
// メイン
// ============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('日米業種リードラグ戦略 - 改良版（Yahoo Finance 直接取得）');
    console.log('='.repeat(70));

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Yahoo Finance から最新データを取得（データ品質確保のため）
    console.log('\n[1/5] Yahoo Finance からデータ取得中（約 30-60 秒）...');
    console.log('  米国 ETF: ' + US_ETF_TICKERS.join(', '));
    console.log('  日本 ETF: ' + JP_ETF_TICKERS.join(', '));
    const usData = await fetchAllData(US_ETF_TICKERS, '2018-01-01', '2025-12-31');
    const jpData = await fetchAllData(JP_ETF_TICKERS, '2018-01-01', '2025-12-31');

    // データ保存（後で使用）
    console.log('\n[2/5] データを保存中...');
    for (const t in usData) {
        const csv = 'Date,Open,High,Low,Close,Volume\n' + usData[t].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
        fs.writeFileSync(path.join(dataDir, `${t}.csv`), csv);
    }
    for (const t in jpData) {
        const csv = 'Date,Open,High,Low,Close,Volume\n' + jpData[t].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
        fs.writeFileSync(path.join(dataDir, `${t}.csv`), csv);
    }
    console.log('  保存完了：data/*.csv');

    // データ処理
    console.log('\n[3/5] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
    console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);
    
    if (dates.length < 100) {
        console.error('エラー：データ不足');
        return;
    }

    const CFull = computeCFull(retUs, retJp);

    // パラメータ最適化
    console.log('\n[3/5] パラメータ最適化...');
    const { config: optConfig, metrics: optMetrics } = optimizeParams(retUs, retJp, retJpOc, SECTOR_LABELS, CFull);

    // 最適パラメータで戦略実行
    console.log('\n[4/5] 戦略実行...');
    
    // PCA SUB（最適パラメータ）
    const resultsSub = runStrategy(retUs, retJp, retJpOc, optConfig, SECTOR_LABELS, CFull, false);
    const metricsSub = computeMetrics(resultsSub.map(r => r.return));
    
    // MOM
    const resultsMom = runStrategy(retUs, retJp, retJpOc, { ...optConfig, lambdaReg: 0 }, retJp, null, true);
    const metricsMom = computeMetrics(resultsMom.map(r => r.return));
    
    // DOUBLE
    const resultsDouble = runDoubleSort(retUs, retJp, retJpOc, optConfig, SECTOR_LABELS, CFull);
    const metricsDouble = computeMetrics(resultsDouble.map(r => r.return));
    
    // PCA PLAIN（λ=0）
    const plainConfig = { ...optConfig, lambdaReg: 0 };
    const resultsPlain = runStrategy(retUs, retJp, retJpOc, plainConfig, SECTOR_LABELS, CFull, false);
    const metricsPlain = computeMetrics(resultsPlain.map(r => r.return));
    
    // 結果表示
    console.log('\n' + '='.repeat(70));
    console.log('戦略比較サマリー');
    console.log('='.repeat(70));
    console.log('Strategy'.padEnd(15) + 'AR (%)'.padStart(10) + 'RISK (%)'.padStart(10) + 'R/R'.padStart(8) + 'MDD (%)'.padStart(10) + 'Total (%)'.padStart(12));
    console.log('-'.repeat(70));
    
    const summary = [
        { name: 'MOM', m: metricsMom },
        { name: 'PCA PLAIN', m: metricsPlain },
        { name: 'PCA SUB', m: metricsSub },
        { name: 'DOUBLE', m: metricsDouble },
    ];
    
    for (const { name, m } of summary) {
        console.log(
            name.padEnd(15) +
            m.AR.toFixed(2).padStart(10) +
            m.RISK.toFixed(2).padStart(10) +
            m.RR.toFixed(2).padStart(8) +
            m.MDD.toFixed(2).padStart(10) +
            m.Total.toFixed(2).padStart(12)
        );
    }
    
    // 結果保存
    const summaryCSV = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Total (%)\n' +
        summary.map(s => `${s.name},${s.m.AR.toFixed(4)},${s.m.RISK.toFixed(4)},${s.m.RR.toFixed(4)},${s.m.MDD.toFixed(4)},${s.m.Total.toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'backtest_summary_improved.csv'), summaryCSV);
    
    // 累積リターン
    for (const { name, m } of summary) {
        const strat = name === 'MOM' ? resultsMom : name === 'PCA PLAIN' ? resultsPlain : name === 'DOUBLE' ? resultsDouble : resultsSub;
        let cum = 1;
        const cumData = strat.map(r => { cum *= (1 + r.return); return { date: r.date, cumulative: cum }; });
        const csv = 'Date,Cumulative\n' + cumData.map(r => `${r.date},${r.cumulative.toFixed(6)}`).join('\n');
        fs.writeFileSync(path.join(outputDir, `cumulative_${name.toLowerCase().replace(' ', '_')}.csv`), csv);
    }
    
    // 最適パラメータ保存
    const paramCSV = `Parameter,Value\nwindowLength,${optConfig.windowLength}\nlambdaReg,${optConfig.lambdaReg}\nquantile,${optConfig.quantile}\nnFactors,${optConfig.nFactors}`;
    fs.writeFileSync(path.join(outputDir, 'optimal_parameters.csv'), paramCSV);
    
    console.log('\n結果保存先:');
    console.log(`  - ${path.join(outputDir, 'backtest_summary_improved.csv')}`);
    console.log(`  - ${path.join(outputDir, 'optimal_parameters.csv')}`);
    console.log(`  - ${outputDir}/cumulative_*.csv`);
    
    // 考察
    console.log('\n' + '='.repeat(70));
    console.log('考察');
    console.log('='.repeat(70));
    
    const bestStrat = summary.reduce((a, b) => a.m.RR > b.m.RR ? a : b);
    console.log(`最良戦略：${bestStrat.name} (R/R=${bestStrat.m.RR.toFixed(2)})`);
    
    if (metricsSub.RR > metricsMom.RR) {
        console.log('✓ PCA SUB はモメンタムを上回りました');
    } else {
        console.log('✗ PCA SUB はモメンタムに敗北しました');
    }
    
    if (metricsDouble.RR > metricsSub.RR) {
        console.log('✓ ダブルソートは追加価値を生みました');
    } else {
        console.log('△ ダブルソートの追加価値は限定的でした');
    }
}

main().catch(e => {
    console.error('エラー:', e);
    process.exit(1);
});
