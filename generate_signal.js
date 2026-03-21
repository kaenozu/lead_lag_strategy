/**
 * シグナル生成ツール - 初心者向け
 * 
 * 毎日の売買指示を具体的な金額とともに出力
 */

const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

// 設定
const CONFIG = {
    windowLength: 40,
    nFactors: 3,
    lambdaReg: 0.95,
    quantile: 0.3,
    warmupPeriod: 40,
};

const RISK_CONFIG = {
    maxPositionSize: 0.10,
    maxTotalExposure: 0.60,
    volatilityTarget: 0.08,
};

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

const SECTOR_NAMES = {
    '1617.T': '食品', '1618.T': 'エネルギー資源', '1619.T': '建設・資材', '1620.T': '素材・化学',
    '1621.T': '医薬品', '1622.T': '自動車・輸送機', '1623.T': '鉄鋼・非鉄', '1624.T': '機械',
    '1625.T': '電機・精密', '1626.T': '情報通信', '1627.T': '電力・ガス', '1628.T': '運輸・物流',
    '1629.T': '商社・卸売', '1630.T': '小売', '1631.T': '銀行', '1632.T': '証券・商品', '1633.T': '保険'
};

const SECTOR_LABELS = {
    'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 'US_XLRE': 'cyclical',
    'US_XLK': 'defensive', 'US_XLP': 'defensive', 'US_XLU': 'defensive', 'US_XLV': 'defensive',
    'US_XLI': 'neutral', 'US_XLC': 'neutral', 'US_XLY': 'neutral',
    'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
    'JP_1619.T': 'neutral', 'JP_1620.T': 'neutral', 'JP_1622.T': 'neutral', 'JP_1623.T': 'neutral',
    'JP_1624.T': 'neutral', 'JP_1626.T': 'neutral', 'JP_1628.T': 'neutral', 'JP_1632.T': 'neutral', 'JP_1633.T': 'neutral',
};

// 線形代数（簡略化）
function transpose(m) { return m[0].map((_, i) => m.map(r => r[i])); }
function dotProduct(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function normalize(v) { const n = norm(v); return n > 1e-10 ? v.map(x => x / n) : v; }
function diag(m) { return m.map((r, i) => r[i]); }
function makeDiag(v) { const n = v.length; const r = new Array(n).fill(0).map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) r[i][i] = v[i]; return r; }
function matmul(A, B) { const rowsA = A.length, colsA = A[0].length, colsB = B[0].length; const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0)); for (let i = 0; i < rowsA; i++) for (let j = 0; j < colsB; j++) for (let k = 0; k < colsA; k++) result[i][j] += A[i][k] * B[k][j]; return result; }

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
        const Av = v.map((_, j) => A.reduce((s, row) => s + row[j] * v[j], 0));
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
    compute(returnsUs, returnsJp, returnsUsLatest, sectorLabels, CFull) {
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
    const usMap = new Map(), jpMap = new Map();
    for (const t in usRet) for (const r of usRet[t]) { if (!usMap.has(r.date)) usMap.set(r.date, {}); usMap.get(r.date)[t] = r.return; }
    for (const t in jpRet) for (const r of jpRet[t]) { if (!jpMap.has(r.date)) jpMap.set(r.date, {}); jpMap.get(r.date)[t] = r.return; }
    const usDates = new Set([...usMap.keys()].sort()), jpDates = new Set([...jpMap.keys()].sort());
    const common = [...usDates].filter(d => jpDates.has(d)).sort();
    const retUs = [], retJp = [], retJpOc = [], dates = [];
    for (let i = 1; i < common.length; i++) {
        const usDate = common[i-1], jpDate = common[i];
        const usRow = US_ETF_TICKERS.map(t => usMap.get(usDate)?.[t] ?? null);
        const jpRow = JP_ETF_TICKERS.map(t => jpMap.get(jpDate)?.[t] ?? null);
        const jpOcRow = JP_ETF_TICKERS.map(t => jpMap.get(jpDate)?.[t] ?? null);
        if (usRow.some(v => v === null) || jpRow.some(v => v === null) || jpOcRow.some(v => v === null)) continue;
        retUs.push({ values: usRow }); retJp.push({ values: jpRow }); retJpOc.push({ values: jpOcRow }); dates.push(jpDate);
    }
    return { retUs, retJp, retJpOc, dates };
}

function computeCFull(retUs, retJp) {
    return correlationMatrix(retUs.map((r, i) => [...r.values, ...retJp[i].values]));
}

function generateSignal(retUs, retJp, retJpOc, config, sectorLabels, CFull) {
    const nJp = JP_ETF_TICKERS.length;
    const signalGen = new LeadLagSignal(config);
    const i = retJpOc.length - 1;
    const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
    const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
    const usLatest = retUs[i - 1].values;
    const signal = signalGen.compute(usWin, jpWin, usLatest, sectorLabels, CFull);
    const indexed = signal.map((val, idx) => ({ val, idx, ticker: JP_ETF_TICKERS[idx] })).sort((a, b) => a.val - b.val);
    const q = Math.floor(nJp * config.quantile);
    return {
        long: indexed.slice(-q).map(s => ({ ticker: s.ticker, sector: SECTOR_NAMES[s.ticker], signal: s.val })),
        short: indexed.slice(0, q).map(s => ({ ticker: s.ticker, sector: SECTOR_NAMES[s.ticker], signal: s.val })),
        all: indexed.map(s => ({ ticker: s.ticker, sector: SECTOR_NAMES[s.ticker], signal: s.val }))
    };
}

function calculateInvestment(longSignals, shortSignals, totalCapital = 1000000) {
    const perPosition = Math.floor(totalCapital / (longSignals.length + shortSignals.length) / 100) * 100;
    return {
        long: longSignals.map(s => ({ ...s, amount: perPosition })),
        short: shortSignals.map(s => ({ ...s, amount: perPosition })),
        totalLong: perPosition * longSignals.length,
        totalShort: perPosition * shortSignals.length,
        remaining: totalCapital - (perPosition * (longSignals.length + shortSignals.length))
    };
}

async function main() {
    console.log('='.repeat(70));
    console.log('📈 日米業種リードラグ戦略 - シグナル生成ツール');
    console.log('='.repeat(70));

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');

    // データ読み込み
    console.log('\n[1/3] データ読み込み中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    // データ処理
    console.log('[2/3] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
    const CFull = computeCFull(retUs, retJp);
    console.log(`  最終取引日：${dates[dates.length - 1]}`);

    // シグナル生成
    console.log('[3/3] シグナル生成中...\n');
    const signal = generateSignal(retUs, retJp, retJpOc, CONFIG, SECTOR_LABELS, CFull);
    const investment = calculateInvestment(signal.long, signal.short, 1000000);

    // 出力
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
    console.log('='.repeat(70));
    console.log(`📅 本日のシグナル（{today}）`);
    console.log('='.repeat(70));

    console.log('\n💰 推奨投資額（総額 100 万円の場合）');
    console.log('-'.repeat(70));
    console.log(`買い合計：${investment.totalLong.toLocaleString()}円`);
    console.log(`売り合計：${investment.totalShort.toLocaleString()}円`);
    console.log(`余力：${investment.remaining.toLocaleString()}円`);

    console.log('\n📊 買い銘柄（ロング）');
    console.log('-'.repeat(70));
    console.log('ランク  ティッカー  業種           投資額      シグナル値');
    investment.long.forEach((s, i) => {
        console.log(`  ${i+1}      ${s.ticker.padEnd(8)}  ${s.sector.padEnd(10)}  ${s.amount.toLocaleString()}円  ${s.signal.toFixed(2)}`);
    });

    console.log('\n📉 売り銘柄（ショート）');
    console.log('-'.repeat(70));
    console.log('ランク  ティッカー  業種           投資額      シグナル値');
    investment.short.forEach((s, i) => {
        console.log(`  ${i+1}      ${s.ticker.padEnd(8)}  ${s.sector.padEnd(10)}  ${s.amount.toLocaleString()}円  ${s.signal.toFixed(2)}`);
    });

    console.log('\n' + '='.repeat(70));
    console.log('📝 取引の注意点');
    console.log('='.repeat(70));
    console.log('1. 買い銘柄は「買って上昇を待つ」、売り銘柄は「空売りして下落を待つ」');
    console.log('2. 各銘柄の投資額は均等配分（リスク分散）');
    console.log('3. 朝 9:00 の寄り付き前に注文を出すのが理想');
    console.log('4. 夕方の大引けで決済する（デイトレード）');
    console.log('5. 週末はポジションを持たないのが安全');

    console.log('\n' + '='.repeat(70));
    console.log('⚠️ リスク警告');
    console.log('='.repeat(70));
    console.log('・元本割れの可能性があります');
    console.log('・過去のパフォーマンスは将来を保証しません');
    console.log('・余力を残して無理な取引はしないでください');
    console.log('・このシグナルは投資助言ではありません');

    // JSON 保存
    const signalJson = {
        date: dates[dates.length - 1],
        generatedAt: new Date().toISOString(),
        parameters: CONFIG,
        signals: {
            long: investment.long,
            short: investment.short
        },
        investment: {
            totalLong: investment.totalLong,
            totalShort: investment.totalShort,
            remaining: investment.remaining,
            totalCapital: 1000000
        }
    };
    fs.writeFileSync(path.join(outputDir, 'signal.json'), JSON.stringify(signalJson, null, 2));

    // CSV 保存
    const longCsv = 'Rank,Ticker,Sector,Amount,Signal\n' + investment.long.map((s, i) => `${i+1},${s.ticker},${s.sector},${s.amount},${s.signal.toFixed(4)}`).join('\n');
    const shortCsv = 'Rank,Ticker,Sector,Amount,Signal\n' + investment.short.map((s, i) => `${i+1},${s.ticker},${s.sector},${s.amount},${s.signal.toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'signal_long.csv'), longCsv);
    fs.writeFileSync(path.join(outputDir, 'signal_short.csv'), shortCsv);

    console.log(`\n💾 保存完了：results/signal.json, signal_long.csv, signal_short.csv`);
    console.log('='.repeat(70));
}

main().catch(console.error);
