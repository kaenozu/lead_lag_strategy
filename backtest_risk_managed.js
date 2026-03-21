/**
 * 日米業種リードラグ戦略 - リスク管理強化版
 * 
 * 初心者向けに最大ドローダウンを抑制し、安定した収益を目指す
 */

const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

// ============================================================================
// 設定（リスク管理強化）
// ============================================================================

const BASE_CONFIG = {
    windowLength: 40,
    nFactors: 3,
    lambdaReg: 0.95,
    quantile: 0.3,
    warmupPeriod: 40,
};

// リスク管理パラメータ
const RISK_CONFIG = {
    maxPositionSize: 0.10,      // 最大ポジションサイズ（10%）
    maxTotalExposure: 0.60,     // 最大エクスポージャー（60%）
    volatilityTarget: 0.08,     // 目標ボラティリティ（8%）
    maxDrawdownLimit: 0.10,     // 最大ドローダウン（10%）
    stopLoss: 0.05,             // ストップロス（5%）
};

// 取引コスト
const TRANSACTION_COSTS = {
    slippage: 0.0005,           // スリッページ（0.05%）
    commission: 0.0003,         // 手数料（0.03%）
};

const PARAM_GRID = {
    windowLength: [40, 60],
    lambdaReg: [0.9, 0.95],
    quantile: [0.3, 0.4],
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

// ============================================================================
// 線形代数
// ============================================================================

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
    for (let j = 0; j < m; j++) { let s = 0; for (let i = 0; i < n; i++) { const d = data[i][j] - means[j]; s += d * d; } stds[j] = Math.sqrt(s / n) + 1e-10; }
    const std = new Array(n).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) std[i][j] = (data[i][j] - means[j]) / stds[j];
    const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) { let s = 0; for (let k = 0; k < n; k++) s += std[k][i] * std[k][j]; corr[i][j] = s / n; }
    return corr;
}

// ============================================================================
// 部分空間正則化 PCA
// ============================================================================

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

// ============================================================================
// リードラグシグナル
// ============================================================================

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

// ============================================================================
// ポートフォリオ構築（リスク管理付き）
// ============================================================================

function buildPortfolio(signal, quantile = 0.3, riskConfig = null, currentVolatility = 0.10) {
    const n = signal.length;
    const q = Math.max(1, Math.floor(n * quantile));
    const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
    const longIdx = indexed.slice(-q).map(x => x.idx);
    const shortIdx = indexed.slice(0, q).map(x => x.idx);

    // 基本ウェイト
    const weights = new Array(n).fill(0);
    const w = 1.0 / q;
    for (const idx of longIdx) weights[idx] = w;
    for (const idx of shortIdx) weights[idx] = -w;

    // リスク管理適用
    if (riskConfig) {
        // ボラティリティ調整
        const volScale = riskConfig.volatilityTarget / Math.max(currentVolatility, 0.01);
        const adjustedScale = Math.min(volScale, 1.0);

        // 最大ポジション制限
        for (let i = 0; i < n; i++) {
            weights[i] *= adjustedScale;
            if (weights[i] > riskConfig.maxPositionSize) weights[i] = riskConfig.maxPositionSize;
            if (weights[i] < -riskConfig.maxPositionSize) weights[i] = -riskConfig.maxPositionSize;
        }

        // 総エクスポージャー制限
        const totalExposure = weights.reduce((s, w) => s + Math.abs(w), 0);
        if (totalExposure > riskConfig.maxTotalExposure) {
            const scale = riskConfig.maxTotalExposure / totalExposure;
            for (let i = 0; i < n; i++) weights[i] *= scale;
        }
    }

    return weights;
}

// ============================================================================
// データ取得・処理
// ============================================================================

async function fetchYahooFinanceData(ticker, startDate = '2018-01-01', endDate = '2025-12-31') {
    try {
        const queryOptions = { period1: startDate, period2: endDate, interval: '1d' };
        const result = await yahooFinance.chart(ticker, queryOptions);
        const data = result.quotes.map(q => ({
            date: q.date.toISOString().split('T')[0],
            open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
        })).filter(d => d.close !== null && d.close > 0);
        return data;
    } catch (e) {
        console.error(`  ${ticker} の取得エラー：${e.message}`);
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
// バックテスト（リスク管理付き）
// ============================================================================

function runStrategyWithRisk(retUs, retJp, retJpOc, config, labels, CFull, riskConfig) {
    const nJp = retJp[0].values.length;
    const results = [];
    const signalGen = new LeadLagSignal(config);
    const totalCost = TRANSACTION_COSTS.slippage + TRANSACTION_COSTS.commission;

    // リスク管理用変数
    let cumulative = 1;
    let runningMax = 1;
    let currentDrawdown = 0;
    let rollingVolatility = 0.10;
    const volWindow = 20;
    const recentReturns = [];

    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const start = i - config.windowLength;
        const retUsWin = retUs.slice(start, i).map(r => r.values);
        const retJpWin = retJp.slice(start, i).map(r => r.values);
        const retUsLatest = retUs[i - 1].values;

        const signal = signalGen.compute(retUsWin, retJpWin, retUsLatest, labels, CFull);

        // ボラティリティ計算
        if (recentReturns.length >= volWindow) {
            const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
            const variance = recentReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / recentReturns.length;
            rollingVolatility = Math.sqrt(variance) * Math.sqrt(252);
        }

        // ポートフォリオ構築（リスク管理付き）
        const weights = riskConfig ? buildPortfolio(signal, config.quantile, riskConfig, rollingVolatility) : buildPortfolio(signal, config.quantile);

        // ドローダウン制御
        if (riskConfig && currentDrawdown < -riskConfig.maxDrawdownLimit * 0.5) {
            const scale = currentDrawdown < -riskConfig.maxDrawdownLimit ? 0.2 : 0.5;
            for (let j = 0; j < nJp; j++) weights[j] *= scale;
        }

        const retNext = retJpOc[i].values;
        let stratRet = 0;
        for (let j = 0; j < nJp; j++) stratRet += weights[j] * retNext[j];

        // 取引コスト
        stratRet = stratRet - totalCost;

        results.push({ date: retJpOc[i].date, return: stratRet, weights: [...weights] });

        // ドローダウン更新
        cumulative *= (1 + stratRet);
        if (cumulative > runningMax) runningMax = cumulative;
        currentDrawdown = (cumulative - runningMax) / runningMax;

        // ボラティリティ履歴更新
        recentReturns.push(stratRet);
        if (recentReturns.length > volWindow) recentReturns.shift();
    }

    return results;
}

// ============================================================================
// パフォーマンス指標
// ============================================================================

function computeMetrics(returns) {
    if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0 };
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
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
// メイン処理
// ============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('日米業種リードラグ戦略 - リスク管理強化版');
    console.log('='.repeat(70));

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // データ取得
    console.log('\n[1/4] Yahoo Finance からデータ取得中...');
    const usData = await fetchAllData(US_ETF_TICKERS, '2018-01-01', '2025-12-31');
    const jpData = await fetchAllData(JP_ETF_TICKERS, '2018-01-01', '2025-12-31');

    // データ処理
    console.log('[2/4] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
    console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

    const CFull = computeCFull(retUs, retJp);

    // パラメータ最適化（簡易）
    console.log('[3/4] パラメータ最適化中...');
    let bestConfig = { ...BASE_CONFIG };
    let bestRR = -Infinity;

    for (const l of PARAM_GRID.lambdaReg) {
        for (const w of PARAM_GRID.windowLength) {
            for (const q of PARAM_GRID.quantile) {
                const config = { ...BASE_CONFIG, lambdaReg: l, windowLength: w, quantile: q, warmupPeriod: w };
                const result = runStrategyWithRisk(retUs, retJp, retJpOc, config, SECTOR_LABELS, CFull, RISK_CONFIG);
                const metrics = computeMetrics(result.map(r => r.return));
                if (metrics.RR > bestRR && metrics.MDD > -20) {
                    bestRR = metrics.RR;
                    bestConfig = { ...config };
                }
            }
        }
    }
    console.log(`  最適パラメータ：λ=${bestConfig.lambdaReg}, window=${bestConfig.windowLength}, q=${bestConfig.quantile}`);

    // 戦略実行（リスク管理あり/なし）
    console.log('[4/4] 戦略実行中...\n');

    const resultNoRisk = runStrategyWithRisk(retUs, retJp, retJpOc, bestConfig, SECTOR_LABELS, CFull, null);
    const resultWithRisk = runStrategyWithRisk(retUs, retJp, retJpOc, bestConfig, SECTOR_LABELS, CFull, RISK_CONFIG);

    const metricsNoRisk = computeMetrics(resultNoRisk.map(r => r.return));
    const metricsWithRisk = computeMetrics(resultWithRisk.map(r => r.return));

    console.log('='.repeat(70));
    console.log('バックテスト結果');
    console.log('='.repeat(70));
    console.log('\nリスク管理なし:');
    console.log(`  AR: ${metricsNoRisk.AR.toFixed(2)}%, R/R: ${metricsNoRisk.RR.toFixed(2)}, MDD: ${metricsNoRisk.MDD.toFixed(2)}%`);
    console.log('\nリスク管理あり:');
    console.log(`  AR: ${metricsWithRisk.AR.toFixed(2)}%, R/R: ${metricsWithRisk.RR.toFixed(2)}, MDD: ${metricsWithRisk.MDD.toFixed(2)}%`);

    // 評価
    console.log('\n' + '='.repeat(70));
    console.log('評価');
    console.log('='.repeat(70));
    if (metricsWithRisk.RR > 0.5) console.log('✓ R/R 比が 0.5 以上（良好）');
    else if (metricsWithRisk.RR > 0) console.log('△ R/R 比が 0 以上（改善の余地あり）');
    else console.log('✗ R/R 比が負（戦略の見直しが必要）');

    if (metricsWithRisk.MDD > -15) console.log('✓ 最大ドローダウンが 15% 以内（良好）');
    else if (metricsWithRisk.MDD > -25) console.log('△ 最大ドローダウンが 25% 以内（許容範囲）');
    else console.log('✗ 最大ドローダウンが 25% 超（リスク管理の強化が必要）');

    // 結果保存
    const summary = [
        { name: 'RiskManaged', ...metricsWithRisk },
        { name: 'NoRiskManagement', ...metricsNoRisk }
    ];
    const csv = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Total (%)\n' +
        summary.map(s => `${s.name},${s.AR.toFixed(4)},${s.RISK.toFixed(4)},${s.RR.toFixed(4)},${s.MDD.toFixed(4)},${s.Total.toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'backtest_summary_risk_managed.csv'), csv);

    console.log('\n結果を保存しました：results/backtest_summary_risk_managed.csv');
    console.log('='.repeat(70));
}

main().catch(console.error);
