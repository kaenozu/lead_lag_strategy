/**
 * 日米業種リードラグ戦略 - 簡易改良版
 * 改善点：
 * 1. 取引コストの適正化
 * 2. 年別パフォーマンス分析
 * 3. 複数パラメータでの比較
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.4,
    warmupPeriod: 60,
    transactionCosts: { slippage: 0.001, commission: 0.0005 },
    annualizationFactor: 252
};

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

const SECTOR_LABELS = {
    'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 'US_XLRE': 'cyclical',
    'US_XLK': 'defensive', 'US_XLP': 'defensive', 'US_XLU': 'defensive', 'US_XLV': 'defensive',
    'US_XLI': 'neutral', 'US_XLC': 'neutral', 'US_XLY': 'neutral',
    'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
    'JP_1619.T': 'neutral', 'JP_1620.T': 'neutral', 'JP_1622.T': 'neutral', 'JP_1623.T': 'neutral',
    'JP_1624.T': 'neutral', 'JP_1626.T': 'neutral', 'JP_1628.T': 'neutral', 'JP_1632.T': 'neutral', 'JP_1633.T': 'neutral',
};

function transpose(matrix) { return matrix[0].map((_, i) => matrix.map(row => row[i])); }
function matmul(A, B) { const r = A.length, c = A[0].length, d = B[0].length; const m = new Array(r).fill(0).map(() => new Array(d).fill(0)); for (let i = 0; i < r; i++) for (let j = 0; j < d; j++) for (let k = 0; k < c; k++) m[i][j] += A[i][k] * B[k][j]; return m; }
function dotProduct(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function normalize(v) { const n = norm(v); return n > 1e-10 ? v.map(x => x / n) : v; }
function diag(m) { return m.map((r, i) => r[i]); }
function makeDiag(v) { const n = v.length; const m = new Array(n).fill(0).map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) m[i][i] = v[i]; return m; }

function eigenDecposition(matrix, k = 3) {
    const n = matrix.length;
    const eigenvalues = [], eigenvectors = [];
    let A = matrix.map(row => [...row]);
    for (let e = 0; e < k; e++) {
        let v = normalize(new Array(n).fill(0).map((_, i) => Math.random()));
        for (let i = 0; i < 1000; i++) {
            const vNew = normalize(v.map((_, j) => A.reduce((s, row) => s + row[j] * v[j], 0)));
            if (norm(vNew) < 1e-10) break;
            v = vNew;
        }
        const Av = v.map((_, j) => A.reduce((s, row) => s + row[j] * v[j], 0));
        eigenvalues.push(dotProduct(v, Av));
        eigenvectors.push(v);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] -= eigenvalues[e] * v[i] * v[j];
    }
    return { eigenvalues, eigenvectors };
}

function correlationMatrix(data) {
    const n = data.length, m = data[0].length;
    const means = new Array(m).fill(0), stds = new Array(m).fill(0);
    for (let j = 0; j < m; j++) { for (let i = 0; i < n; i++) means[j] += data[i][j]; means[j] /= n; }
    for (let j = 0; j < m; j++) { let s = 0; for (let i = 0; i < n; i++) { const d = data[i][j] - means[j]; s += d * d; } stds[j] = Math.sqrt(s / n) + 1e-10; }
    const std = data.map(row => row.map((x, j) => (x - means[j]) / stds[j]));
    const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) corr[i][j] = std.reduce((s, r) => s + r[i] * r[j], 0) / n;
    return corr;
}

class SubspaceRegularizedPCA {
    constructor(config) { this.config = config; this.C0 = null; }
    buildPriorSpace(nUs, nJp, sectorLabels, CFull) {
        const N = nUs + nJp, keys = Object.keys(sectorLabels);
        let v1 = normalize(new Array(N).fill(1));
        let v2 = new Array(N).fill(0);
        for (let i = 0; i < nUs; i++) v2[i] = 1; for (let i = nUs; i < N; i++) v2[i] = -1;
        v2 = normalize(v2.map((x, i) => x - dotProduct(v2, v1) * v1[i]));
        let v3 = new Array(N).fill(0);
        for (let i = 0; i < N; i++) { const k = keys[i]; if (sectorLabels[k] === 'cyclical') v3[i] = 1; else if (sectorLabels[k] === 'defensive') v3[i] = -1; }
        v3 = normalize(v3.map((x, i) => x - dotProduct(v3, v1) * v1[i] - dotProduct(v3, v2) * v2[i]));
        const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);
        const D0 = diag(matmul(transpose(V0), matmul(CFull, V0)));
        const C0Raw = matmul(matmul(V0, makeDiag(D0)), transpose(V0));
        const delta = diag(C0Raw);
        const inv = delta.map(x => 1 / Math.sqrt(Math.abs(x) + 1e-10));
        let C0 = matmul(matmul(makeDiag(inv), C0Raw), makeDiag(inv));
        for (let i = 0; i < N; i++) C0[i][i] = 1;
        this.C0 = C0;
    }
    computeRegularizedPCA(returns, sectorLabels, CFull) {
        const nUs = Object.keys(sectorLabels).filter(k => k.startsWith('US_')).length;
        const nJp = Object.keys(sectorLabels).filter(k => k.startsWith('JP_')).length;
        if (!this.C0) this.buildPriorSpace(nUs, nJp, sectorLabels, CFull);
        const CT = correlationMatrix(returns), N = CT.length, λ = this.config.lambdaReg;
        const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0).map((_, j, i) => (1 - λ) * CT[i][j] + λ * this.C0[i][j]));
        return { VK: transpose(eigenDecposition(CReg, this.config.nFactors).eigenvectors) };
    }
}

class LeadLagSignal {
    constructor(config) { this.config = config; this.pca = new SubspaceRegularizedPCA(config); }
    computeSignal(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
        const nSamples = returnsUs.length, nUs = returnsUs[0].length, nJp = returnsJp[0].length;
        const combined = returnsUs.map((r, i) => [...r, ...returnsJp[i]]);
        const N = nUs + nJp;
        const mu = combined[0].map((_, j) => combined.reduce((s, r) => s + r[j], 0) / nSamples);
        const sigma = combined[0].map((_, j) => Math.sqrt(combined.reduce((s, r) => s + (r[j] - mu[j]) ** 2, 0) / nSamples) + 1e-10);
        const std = combined.map(r => r.map((x, j) => (x - mu[j]) / sigma[j]));
        const { VK } = this.pca.computeRegularizedPCA(std, sectorLabels, CFull);
        const VUs = VK.slice(0, nUs), VJp = VK.slice(nUs);
        const zLatest = returnsUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        const fT = VUs.map(v => dotProduct(v, zLatest));
        return VJp.map(v => dotProduct(v, fT));
    }
}

function buildPortfolio(signal, quantile = 0.3) {
    const n = signal.length, q = Math.max(1, Math.floor(n * quantile));
    const idx = signal.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const weights = new Array(n).fill(0);
    idx.slice(-q).forEach(x => weights[x.i] = 1 / q);
    idx.slice(0, q).forEach(x => weights[x.i] = -1 / q);
    return weights;
}

function computeMetrics(returns, ann = 252) {
    if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cum: 1 };
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * ann;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(ann);
    let cum = 1, max = 1, mdd = 0;
    for (const r of returns) { cum *= (1 + r); if (cum > max) max = cum; const dd = (cum - max) / max; if (dd < mdd) mdd = dd; }
    return { AR: ar, RISK: risk, RR: risk ? ar / risk : 0, MDD: mdd, Cum: cum };
}

function loadLocalData(dataDir, tickers) {
    const results = {};
    for (const t of tickers) {
        const f = path.join(dataDir, `${t}.csv`);
        if (fs.existsSync(f)) {
            const lines = fs.readFileSync(f, 'utf-8').split('\n').slice(1).filter(ln => ln.trim());
            results[t] = lines.map(ln => { const [d, o, h, lo, c, v] = ln.split(','); return { date: d, open: +o, close: +c }; });
        } else results[t] = [];
    }
    return results;
}

function alignData(usData, jpData) {
    const dateMap = new Map();
    for (const [t, d] of Object.entries(usData)) for (const r of d) { if (!dateMap.has(r.date)) dateMap.set(r.date, {}); dateMap.get(r.date)[t] = r; }
    for (const [t, d] of Object.entries(jpData)) for (const r of d) { if (!dateMap.has(r.date)) dateMap.set(r.date, {}); dateMap.get(r.date)[t] = r; }
    const dates = Array.from(dateMap.keys()).sort();
    const aligned = [];
    for (const date of dates) {
        const d = dateMap.get(date);
        if (US_ETF_TICKERS.every(t => d[t]) && JP_ETF_TICKERS.every(t => d[t])) {
            aligned.push({ date, us: US_ETF_TICKERS.map(t => d[t]), jp: JP_ETF_TICKERS.map(t => d[t]) });
        }
    }
    return aligned;
}

function computeReturns(aligned, type = 'close') {
    const usRet = [], jpRet = [], jpRetOc = [];
    let usPrev = null, jpPrev = null;
    for (let i = 0; i < aligned.length; i++) {
        const { date, us, jp } = aligned[i];
        const usVals = us.map(r => r.close);
        const jpVals = jp.map(r => r.close);
        const jpOpen = jp.map(r => r.open);
        if (usPrev) usRet.push({ date, values: usVals.map((v, j) => (v - usPrev[j]) / usPrev[j]) });
        if (jpPrev) jpRet.push({ date, values: jpVals.map((v, j) => (v - jpPrev[j]) / jpPrev[j]) });
        jpRetOc.push({ date, values: jpVals.map((v, j) => (v - jpOpen[j]) / jpOpen[j]) });
        usPrev = usVals; jpPrev = jpVals;
    }
    return { usRet, jpRet, jpRetOc };
}

function computeCFull(usRet, jpRet) {
    const combined = usRet.map((r, i) => [...r.values, ...jpRet[i].values]);
    return correlationMatrix(combined);
}

function runBacktest(usRet, jpRet, jpRetOc, config, sectorLabels, CFull) {
    const nJp = JP_ETF_TICKERS.length, signalGen = new LeadLagSignal(config);
    const results = [];
    for (let i = config.warmupPeriod; i < jpRetOc.length; i++) {
        const usWin = usRet.slice(i - config.windowLength, i).map(r => r.values);
        const jpWin = jpRet.slice(i - config.windowLength, i).map(r => r.values);
        const usLatest = usRet[i - 1].values;
        const signal = signalGen.computeSignal(usWin, jpWin, usLatest, sectorLabels, CFull);
        const weights = buildPortfolio(signal, config.quantile);
        const retNext = jpRetOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0);
        ret = ret - (config.transactionCosts.slippage + config.transactionCosts.commission);
        results.push({ date: jpRetOc[i].date, return: ret });
    }
    return results;
}

function yearlyPerformance(results) {
    const byYear = {};
    for (const r of results) { const y = r.date.slice(0, 4); if (!byYear[y]) byYear[y] = []; byYear[y].push(r.return); }
    return Object.fromEntries(Object.entries(byYear).map(([y, rets]) => [y, computeMetrics(rets)]));
}

async function main() {
    console.log('======================================================================');
    console.log('日米業種リードラグ戦略 - 簡易改良版');
    console.log('======================================================================\n');
    const dataDir = path.join(__dirname, 'data');

    console.log('[1/4] データ読み込み...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
    US_ETF_TICKERS.forEach(t => console.log(`  ${t}: ${usData[t]?.length || 0} 日`));
    JP_ETF_TICKERS.forEach(t => console.log(`  ${t}: ${jpData[t]?.length || 0} 日`));

    console.log('\n[2/4] データ整合...');
    const aligned = alignData(usData, jpData);
    console.log(`  共通取引日数：${aligned.length}`);
    console.log(`  期間：${aligned[0]?.date} ~ ${aligned[aligned.length - 1]?.date}`);

    console.log('\n[3/4] リターン計算・相関行列...');
    const { usRet, jpRet, jpRetOc } = computeReturns(aligned);
    const CFull = computeCFull(usRet, jpRet);

    console.log('\n[4/4] 複数パラメータでバックテスト...\n');

    // 複数パラメータで比較
    const paramSets = [
        { name: 'Base', lambda: 0.9, window: 60, quantile: 0.4, factors: 3 },
        { name: 'HighReg', lambda: 0.95, window: 60, quantile: 0.35, factors: 3 },
        { name: 'LowWindow', lambda: 0.9, window: 40, quantile: 0.3, factors: 3 },
        { name: 'MoreFactors', lambda: 0.9, window: 60, quantile: 0.35, factors: 4 },
    ];

    const allResults = [];
    for (const p of paramSets) {
        const config = { ...CONFIG, lambdaReg: p.lambda, windowLength: p.window, quantile: p.quantile, nFactors: p.factors, warmupPeriod: Math.max(p.window, 60) };
        const result = runBacktest(usRet, jpRet, jpRetOc, config, SECTOR_LABELS, CFull);
        const metrics = computeMetrics(result.map(r => r.return));
        allResults.push({ name: p.name, params: p, metrics, result });
        console.log(`${p.name}: AR=${(metrics.AR * 100).toFixed(2)}%, R/R=${metrics.RR.toFixed(2)}, MDD=${(metrics.MDD * 100).toFixed(2)}%, Cum=${((metrics.Cum - 1) * 100).toFixed(2)}%`);
    }

    // 最佳結果を表示
    const best = allResults.reduce((a, b) => a.metrics.RR > b.metrics.RR ? a : b);
    console.log(`\n最佳戦略：${best.name}`);
    console.log(`パラメータ：λ=${best.params.lambda}, W=${best.params.window}, q=${best.params.quantile}, K=${best.params.factors}`);

    // 年別パフォーマンス
    console.log('\n============================================================');
    console.log('年別パフォーマンス（最佳戦略）');
    console.log('============================================================');
    const yearly = yearlyPerformance(best.result);
    console.log('Year'.padEnd(8) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10));
    console.log('-'.repeat(40));
    for (const [y, m] of Object.entries(yearly)) {
        console.log(y.padEnd(8) + (m.AR * 100).toFixed(2).padStart(10) + m.RR.toFixed(2).padStart(10) + (m.MDD * 100).toFixed(2).padStart(10));
    }

    // 結果保存
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    let cum = 1;
    const cumData = best.result.map(r => { cum *= (1 + r.return); return `${r.date},${cum.toFixed(6)}`; });
    fs.writeFileSync(path.join(resultsDir, 'cumulative_simple.csv'), 'Date,Cumulative\n' + cumData.join('\n'));
    fs.writeFileSync(path.join(resultsDir, 'params_simple.csv'), 'Parameter,Value\n' + Object.entries(best.params).map(([k, v]) => `${k},${v}`).join('\n'));

    console.log('\n結果を保存しました：results/cumulative_simple.csv');
    console.log('\n======================================================================');
}

main().catch(console.error);
