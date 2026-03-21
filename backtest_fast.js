/**
 * 日米業種リードラグ戦略 - クイック実行版
 * グリッドサーチをスキップし、既知の良好パラメータで即時実行
 */

const fs = require('fs');
const path = require('path');

// 良好なパラメータ（既存の実験結果から）
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

// 線形代数（backtest_real.js から移植）
function transpose(m) { return m[0].map((_, i) => m.map(r => r[i])); }
function matmul(A, B) {
    const r = A.length, c = A[0].length, d = B[0].length;
    const m = new Array(r).fill(0).map(() => new Array(d).fill(0));
    for (let i = 0; i < r; i++) for (let j = 0; j < d; j++) for (let k = 0; k < c; k++) m[i][j] += A[i][k] * B[k][j];
    return m;
}
function dotProduct(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function normalize(v) { const n = norm(v); return n > 1e-10 ? v.map(x => x / n) : v; }
function diag(m) { return m.map((r, i) => r[i]); }
function makeDiag(v) {
    const n = v.length;
    const m = new Array(n).fill(0).map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) m[i][i] = v[i];
    return m;
}

function eigenDecposition(matrix, k = 3) {
    const n = matrix.length, eigenvalues = [], eigenvectors = [];
    let A = matrix.map(row => [...row]);
    for (let e = 0; e < k; e++) {
        let v = normalize(new Array(n).fill(0).map((_, i) => Math.random()));
        for (let iter = 0; iter < 1000; iter++) {
            let vNew = new Array(n).fill(0);
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) vNew[i] += A[i][j] * v[j];
            const newNorm = norm(vNew);
            if (newNorm < 1e-10) break;
            v = vNew.map(x => x / newNorm);
        }
        const Av = new Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j];
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
    for (let j = 0; j < m; j++) {
        let s = 0;
        for (let i = 0; i < n; i++) { const d = data[i][j] - means[j]; s += d * d; }
        stds[j] = Math.sqrt(s / n) + 1e-10;
    }
    const std = new Array(n).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) std[i][j] = (data[i][j] - means[j]) / stds[j];
    const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += std[k][i] * std[k][j];
        corr[i][j] = s / n;
    }
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
        for (let i = 0; i < N; i++) {
            const k = keys[i];
            if (sectorLabels[k] === 'cyclical') v3[i] = 1;
            else if (sectorLabels[k] === 'defensive') v3[i] = -1;
        }
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
        const CReg = new Array(N).fill(0).map((_, i) => new Array(N).fill(0).map((_, j) => (1 - λ) * CT[i][j] + λ * this.C0[i][j]));
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
    const n = signal.length;
    const q = Math.max(1, Math.floor(n * quantile));
    const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
    const longIdx = indexed.slice(-q).map(x => x.idx);
    const shortIdx = indexed.slice(0, q).map(x => x.idx);
    const weights = new Array(n).fill(0);
    for (const idx of longIdx) weights[idx] = 1.0 / q;
    for (const idx of shortIdx) weights[idx] = -1.0 / q;
    return weights;
}

function computeMetrics(returns, ann = 252) {
    if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cumulative: 1 };
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * ann;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(ann);
    let cum = 1, max = 1, mdd = 0;
    for (const r of returns) { cum *= (1 + r); if (cum > max) max = cum; const dd = (cum - max) / max; if (dd < mdd) mdd = dd; }
    return { AR: ar, RISK: risk, RR: risk ? ar / risk : 0, MDD: mdd, Cumulative: cum };
}

function loadLocalData(dataDir, tickers) {
    const results = {};
    for (const t of tickers) {
        const f = path.join(dataDir, `${t}.csv`);
        if (fs.existsSync(f)) {
            const lines = fs.readFileSync(f, 'utf-8').split('\n').slice(1).filter(ln => ln.trim());
            results[t] = lines.map(ln => { const p = ln.split(','); return { date: p[0], open: +p[1], close: +p[4] }; });
        } else results[t] = [];
    }
    return results;
}

function buildReturnMatrices(usData, jpData) {
    const usCCReturns = {}, jpCCReturns = {}, jpOCReturns = {};
    for (const t of Object.keys(usData)) {
        const d = usData[t];
        const ret = [];
        for (let i = 1; i < d.length; i++) ret.push({ date: d[i].date, return: (d[i].close - d[i-1].close) / d[i-1].close });
        usCCReturns[t] = ret;
    }
    for (const t of Object.keys(jpData)) {
        const d = jpData[t];
        const cc = [], oc = [];
        for (let i = 1; i < d.length; i++) cc.push({ date: d[i].date, return: (d[i].close - d[i-1].close) / d[i-1].close });
        for (let i = 0; i < d.length; i++) if (d[i].open > 0) oc.push({ date: d[i].date, return: (d[i].close - d[i].open) / d[i].open });
        jpCCReturns[t] = cc;
        jpOCReturns[t] = oc;
    }

    const usMap = new Map(), jpMap = new Map();
    for (const t in usCCReturns) for (const r of usCCReturns[t]) { if (!usMap.has(r.date)) usMap.set(r.date, {}); usMap.get(r.date)[t] = r.return; }
    for (const t in jpCCReturns) for (const r of jpCCReturns[t]) { if (!jpMap.has(r.date)) jpMap.set(r.date, {}); jpMap.get(r.date)[t] = r.return; }

    const usDates = new Set([...usMap.keys()].sort()), jpDates = new Set([...jpMap.keys()].sort());
    const commonDates = [...usDates].filter(d => jpDates.has(d)).sort();
    
    // 2018 年以降に制限（日本 ETF データが揃っている期間）
    const filteredDates = commonDates.filter(d => d >= '2018-01-01');

    const returnsUs = [], returnsJp = [], returnsJpOc = [], dates = [];
    for (let i = 1; i < filteredDates.length; i++) {
        const usDate = filteredDates[i-1], jpDate = filteredDates[i];
        const usRow = Object.fromEntries(US_ETF_TICKERS.map(t => [t, usMap.get(usDate)?.[t] ?? 0]));
        const jpRow = Object.fromEntries(JP_ETF_TICKERS.map(t => [t, jpMap.get(jpDate)?.[t] ?? 0]));
        const jpOcRow = Object.fromEntries(JP_ETF_TICKERS.map(t => [t, jpMap.get(jpDate)?.[t] ?? 0]));

        let valid = true;
        for (const t of US_ETF_TICKERS) if (usRow[t] === undefined) valid = false;
        for (const t of JP_ETF_TICKERS) if (jpRow[t] === undefined) valid = false;

        if (valid) {
            returnsUs.push({ values: US_ETF_TICKERS.map(t => usRow[t]), date: usDate });
            returnsJp.push({ values: JP_ETF_TICKERS.map(t => jpRow[t]), date: jpDate });
            returnsJpOc.push({ values: JP_ETF_TICKERS.map(t => jpOcRow[t]), date: jpDate });
            dates.push(jpDate);
        }
    }
    return { returnsUs, returnsJp, returnsJpOc, dates };
}

function computeCFull(returnsUs, returnsJp) {
    const combined = returnsUs.map((r, i) => [...r.values, ...returnsJp[i].values]);
    return correlationMatrix(combined);
}

function runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull, strategy = 'PCA_SUB') {
    const nJp = JP_ETF_TICKERS.length;
    const signalGen = new LeadLagSignal(config);
    const strategyReturns = [];
    const costs = config.transactionCosts || { slippage: 0.001, commission: 0.0005 };
    const totalCost = costs.slippage + costs.commission;

    for (let i = config.warmupPeriod; i < returnsJpOc.length; i++) {
        const usWin = returnsUs.slice(i - config.windowLength, i).map(r => r.values);
        const jpWin = returnsJp.slice(i - config.windowLength, i).map(r => r.values);
        const usLatest = returnsUs[i - 1].values;

        let signal;
        if (strategy === 'PCA_PLAIN') {
            // 正則化なし PCA
            const plainConfig = { ...config, lambdaReg: 0 };
            const plainGen = new LeadLagSignal(plainConfig);
            signal = plainGen.computeSignal(usWin, jpWin, usLatest, sectorLabels, CFull);
        } else {
            signal = signalGen.computeSignal(usWin, jpWin, usLatest, sectorLabels, CFull);
        }

        const weights = buildPortfolio(signal, config.quantile);
        const retNext = returnsJpOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0);
        ret = ret - totalCost;
        strategyReturns.push({ date: returnsJpOc[i].date, return: ret });
    }
    return strategyReturns;
}

function runMomentumStrategy(returnsJp, returnsJpOc, window = 60, quantile = 0.3, transactionCosts) {
    const nJp = JP_ETF_TICKERS.length;
    const strategyReturns = [];
    const totalCost = transactionCosts.slippage + transactionCosts.commission;

    for (let i = window; i < returnsJpOc.length; i++) {
        const momentum = new Array(nJp).fill(0);
        for (let j = i - window; j < i; j++) {
            for (let k = 0; k < nJp; k++) momentum[k] += returnsJp[j].values[k];
        }
        for (let k = 0; k < nJp; k++) momentum[k] /= window;

        const weights = buildPortfolio(momentum, quantile);
        const retNext = returnsJpOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0);
        ret = ret - totalCost;
        strategyReturns.push({ date: returnsJpOc[i].date, return: ret });
    }
    return strategyReturns;
}

async function main() {
    console.log('======================================================================');
    console.log('日米業種リードラグ戦略 - クイック実行版');
    console.log('======================================================================\n');

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    console.log('[1/5] データ読み込み...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    console.log('\n[2/5] リターン行列構築...');
    const { returnsUs, returnsJp, returnsJpOc, dates } = buildReturnMatrices(usData, jpData);
    console.log(`  共通取引日数：${dates.length}`);
    console.log(`  期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

    console.log('\n[3/5] 相関行列計算...');
    const CFull = computeCFull(returnsUs, returnsJp);

    console.log('\n[4/5] 戦略バックテスト...\n');

    const strategies = [
        { name: 'PCA_SUB', desc: '部分空間正則化 PCA' },
        { name: 'PCA_PLAIN', desc: '正則化なし PCA' },
        { name: 'MOMENTUM', desc: '単純モメンタム' }
    ];

    const results = [];

    for (const s of strategies) {
        let result;
        if (s.name === 'MOMENTUM') {
            result = runMomentumStrategy(returnsJp, returnsJpOc, CONFIG.windowLength, CONFIG.quantile, CONFIG.transactionCosts);
        } else {
            result = runBacktest(returnsUs, returnsJp, returnsJpOc, CONFIG, SECTOR_LABELS, CFull, s.name);
        }
        const metrics = computeMetrics(result.map(r => r.return));
        results.push({ name: s.name, desc: s.desc, result, metrics });
        console.log(`${s.name.padEnd(12)} (${s.desc}):`);
        console.log(`  AR=${(metrics.AR*100).toFixed(2)}%, R/R=${metrics.RR.toFixed(2)}, MDD=${(metrics.MDD*100).toFixed(2)}%, Cum=${((metrics.Cumulative-1)*100).toFixed(2)}%`);
    }

    console.log('\n[5/5] 結果保存...\n');

    // 最佳戦略
    const best = results.reduce((a, b) => a.metrics.RR > b.metrics.RR ? a : b);
    console.log(`最佳戦略：${best.name} (${best.desc})`);

    // 年別パフォーマンス
    console.log('\n============================================================');
    console.log('年別パフォーマンス');
    console.log('============================================================');
    const byYear = {};
    for (const r of best.result) {
        if (r.date) {
            const y = r.date.slice(0, 4);
            if (!byYear[y]) byYear[y] = [];
            byYear[y].push(r.return);
        }
    }
    console.log('Year'.padEnd(8) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10));
    console.log('-'.repeat(40));
    for (const [y, rets] of Object.entries(byYear).sort()) {
        const m = computeMetrics(rets);
        console.log(y.padEnd(8) + (m.AR*100).toFixed(2).padStart(10) + m.RR.toFixed(2).padStart(10) + (m.MDD*100).toFixed(2).padStart(10));
    }

    // 累積リターン保存
    let cum = 1;
    const cumData = best.result.map(r => { cum *= (1 + r.return); return `${r.date},${cum.toFixed(6)}`; });
    fs.writeFileSync(path.join(outputDir, 'cumulative_quick.csv'), 'Date,Cumulative\n' + cumData.join('\n'));

    // 戦略比較サマリー
    console.log('\n============================================================');
    console.log('戦略比較サマリー');
    console.log('============================================================');
    console.log('Strategy'.padEnd(15) + 'AR (%)'.padStart(10) + 'RISK (%)'.padStart(12) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(12));
    console.log('-'.repeat(60));
    for (const r of results) {
        console.log(r.name.padEnd(15) +
            (r.metrics.AR * 100).toFixed(2).padStart(10) +
            (r.metrics.RISK * 100).toFixed(2).padStart(12) +
            r.metrics.RR.toFixed(2).padStart(10) +
            (r.metrics.MDD * 100).toFixed(2).padStart(12));
    }

    console.log('\n結果を保存しました：results/cumulative_quick.csv');
    console.log('\n======================================================================');
}

main().catch(console.error);
