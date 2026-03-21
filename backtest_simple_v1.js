/**
 * 日米業種リードラグ戦略 - 初心者向け簡易版
 * 高速実行・結果確認用
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.4,
    warmupPeriod: 60,
    transactionCosts: { slippage: 0.0005, commission: 0.0003 }
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

// 線形代数（簡易）
function transpose(m) { return m[0].map((_, i) => m.map(r => r[i])); }
function dotProduct(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function normalize(v) { const n = norm(v); return n > 1e-10 ? v.map(x => x / n) : v; }
function diag(m) { return m.map((r, i) => r[i]); }
function makeDiag(v) { const n = v.length; const r = new Array(n).fill(0).map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) r[i][i] = v[i]; return r; }
function matmul(A, B) { const r = A.length, c = A[0].length, d = B[0].length; const m = new Array(r).fill(0).map(() => new Array(d).fill(0)); for (let i = 0; i < r; i++) for (let j = 0; j < d; j++) for (let k = 0; k < c; k++) m[i][j] += A[i][k] * B[k][j]; return m; }

function eigenDecposition(matrix, k = 3) {
    const n = matrix.length, eigenvalues = [], eigenvectors = [];
    let A = matrix.map(row => [...row]);
    for (let e = 0; e < k; e++) {
        let v = normalize(new Array(n).fill(0).map((_, i) => Math.random()));
        for (let i = 0; i < 1000; i++) {
            let vNew = new Array(n).fill(0);
            for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) vNew[j] += A[j][l] * v[l];
            const nn = norm(vNew); if (nn < 1e-10) break; v = vNew.map(x => x / nn);
        }
        const Av = new Array(n).fill(0);
        for (let ii = 0; ii < n; ii++)
            for (let jj = 0; jj < n; jj++) Av[ii] += A[ii][jj] * v[jj];
        eigenvalues.push(dotProduct(v, Av)); eigenvectors.push(v);
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
    const n = signal.length, q = Math.max(1, Math.floor(n * quantile));
    const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
    const weights = new Array(n).fill(0);
    indexed.slice(-q).forEach(x => weights[x.idx] = 1/q);
    indexed.slice(0, q).forEach(x => weights[x.idx] = -1/q);
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
            const lines = fs.readFileSync(f, 'utf-8').split('\n').slice(1).filter(l => l.trim());
            results[t] = lines.map(l => { const p = l.split(','); return { date: p[0], open: +p[1], close: +p[4] }; });
        } else results[t] = [];
    }
    return results;
}

function buildMatrices(usData, jpData) {
    const usRet = {}, jpRet = {}, jpRetOc = {};
    for (const t in usData) {
        const d = usData[t], ret = [], prev = { value: null };
        for (const r of d) {
            if (prev.value !== null) ret.push({ date: r.date, return: (r.close - prev.value) / prev.value });
            prev.value = r.close;
        }
        usRet[t] = ret;
    }
    for (const t in jpData) {
        const d = jpData[t], cc = [], oc = [], prev = { value: null };
        for (const r of d) {
            if (prev.value !== null) cc.push({ date: r.date, return: (r.close - prev.value) / prev.value });
            if (r.open > 0) oc.push({ date: r.date, return: (r.close - r.open) / r.open });
            prev.value = r.close;
        }
        jpRet[t] = cc; jpRetOc[t] = oc;
    }
    const usMap = new Map(), jpMap = new Map(), jpOCMap = new Map();
    for (const t in usRet) for (const r of usRet[t]) { if (!usMap.has(r.date)) usMap.set(r.date, {}); usMap.get(r.date)[t] = r.return; }
    for (const t in jpRet) for (const r of jpRet[t]) { if (!jpMap.has(r.date)) jpMap.set(r.date, {}); jpMap.get(r.date)[t] = r.return; }
    for (const t in jpRetOc) for (const r of jpRetOc[t]) { if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {}); jpOCMap.get(r.date)[t] = r.return; }
    const usDates = new Set([...usMap.keys()].sort()), jpDates = new Set([...jpMap.keys()].sort());
    const common = [...usDates].filter(d => jpDates.has(d)).sort();
    const retUs = [], retJp = [], retJpOc = [], dates = [];
    for (let i = 1; i < common.length; i++) {
        const usDate = common[i-1], jpDate = common[i];
        const usRow = US_ETF_TICKERS.map(t => usMap.get(usDate)?.[t] ?? null);
        const jpRow = JP_ETF_TICKERS.map(t => jpMap.get(jpDate)?.[t] ?? null);
        const jpOcRow = JP_ETF_TICKERS.map(t => jpOCMap.get(jpDate)?.[t] ?? null);
        if (usRow.some(v => v === null) || jpRow.some(v => v === null) || jpOcRow.some(v => v === null)) continue;
        retUs.push({ values: usRow }); retJp.push({ values: jpRow }); retJpOc.push({ values: jpOcRow }); dates.push(jpDate);
    }
    return { retUs, retJp, retJpOc, dates };
}

function computeCFull(retUs, retJp) { return correlationMatrix(retUs.map((r, i) => [...r.values, ...retJp[i].values])); }

function runBacktest(retUs, retJp, retJpOc, config, sectorLabels, CFull) {
    const nJp = JP_ETF_TICKERS.length, signalGen = new LeadLagSignal(config);
    const results = [], totalCost = config.transactionCosts.slippage + config.transactionCosts.commission;
    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
        const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
        const usLatest = retUs[i - 1].values;
        const signal = signalGen.computeSignal(usWin, jpWin, usLatest, sectorLabels, CFull);
        const weights = buildPortfolio(signal, config.quantile);
        const retNext = retJpOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0) - totalCost;
        results.push({ date: retJpOc[i].date, return: ret });
    }
    return results;
}

async function main() {
    console.log('='.repeat(70));
    console.log('日米業種リードラグ戦略 - 初心者向け簡易版');
    console.log('='.repeat(70));
    const dataDir = path.join(__dirname, 'data'), outputDir = path.join(__dirname, 'results');
    console.log('\n[1/4] データ読み込み中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS), jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
    console.log('[2/4] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
    console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);
    console.log('[3/4] 相関行列計算中...');
    const CFull = computeCFull(retUs, retJp);
    console.log('[4/4] バックテスト中...\n');
    const result = runBacktest(retUs, retJp, retJpOc, CONFIG, SECTOR_LABELS, CFull);
    const metrics = computeMetrics(result.map(r => r.return));
    console.log('='.repeat(70));
    console.log('バックテスト結果');
    console.log('='.repeat(70));
    console.log(`年率リターン (AR): ${(metrics.AR*100).toFixed(2)}%`);
    console.log(`年率リスク (RISK): ${(metrics.RISK*100).toFixed(2)}%`);
    console.log(`リスク・リターン比 (R/R): ${metrics.RR.toFixed(2)}`);
    console.log(`最大ドローダウン (MDD): ${(metrics.MDD*100).toFixed(2)}%`);
    console.log(`累積リターン: ${(metrics.Cumulative*100).toFixed(2)}%`);
    // 年別パフォーマンス
    console.log('\n' + '='.repeat(70));
    console.log('年別パフォーマンス');
    console.log('='.repeat(70));
    const byYear = {};
    for (const r of result) { if (r.date) { const y = r.date.slice(0,4); if (!byYear[y]) byYear[y] = []; byYear[y].push(r.return); } }
    console.log('Year'.padEnd(8) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10));
    console.log('-'.repeat(40));
    for (const [y, rets] of Object.entries(byYear).sort()) { const m = computeMetrics(rets); console.log(y.padEnd(8) + (m.AR*100).toFixed(2).padStart(10) + m.RR.toFixed(2).padStart(10) + (m.MDD*100).toFixed(2).padStart(10)); }
    // 結果保存
    const summary = [{ name: 'PCA_SUB', ...metrics }];
    const csv = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Cumulative\n' + summary.map(s => `${s.name},${(s.AR*100).toFixed(4)},${(s.RISK*100).toFixed(4)},${s.RR.toFixed(4)},${(s.MDD*100).toFixed(4)},${s.Cumulative.toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'backtest_summary_v1_simple.csv'), csv);
    console.log('\n結果を保存しました：results/backtest_summary_v1_simple.csv');
    console.log('\n' + '='.repeat(70));
    console.log('評価');
    console.log('='.repeat(70));
    if (metrics.RR > 0.5) console.log('✓ R/R 比が 0.5 以上（良好）');
    else if (metrics.RR > 0) console.log('△ R/R 比が 0 以上（改善の余地あり）');
    else console.log('✗ R/R 比が負（戦略の見直しが必要）');
    if (metrics.MDD > -0.15) console.log('✓ 最大ドローダウンが 15% 以内（良好）');
    else if (metrics.MDD > -0.25) console.log('△ 最大ドローダウンが 25% 以内（許容範囲）');
    else console.log('✗ 最大ドローダウンが 25% 超（リスク管理の強化が必要）');
    console.log('='.repeat(70));
}

main().catch(console.error);
