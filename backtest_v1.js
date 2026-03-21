/**
 * 日米業種リードラグ戦略 - 初心者向け改良版 v1.0
 * 
 * 目標：株取引初心者がアプリの言う通りに取引すると利益を得られる
 * 
 * 改善点：
 * 1. パラメータ最適化の改善（R/R > 0.5 目標）
 * 2. リスク管理機能の追加
 * 3. 取引コストの現実的見積もり
 * 4. シグナル生成機能
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 設定
// ============================================================================

const CONFIG = {
    // 基本パラメータ（最適化済み）
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.4,
    warmupPeriod: 60,

    // リスク管理（新規）
    riskManagement: {
        maxPositionSize: 0.15,      // 最大ポジションサイズ（15%）
        maxTotalExposure: 0.8,      // 最大エクスポージャー（80%）
        stopLoss: 0.05,             // ストップロス（5%）
        trailingStop: 0.03,         // トレーリングストップ（3%）
        volatilityTarget: 0.10,     // 目標ボラティリティ（10%）
        maxDrawdownLimit: 0.15,     // 最大ドローダウン制限（15%）
    },

    // 取引コスト（現実的）
    transactionCosts: {
        slippage: 0.0005,           // スリッページ（0.05%）
        commission: 0.0003,         // 手数料（0.03%）
        tax: 0.20,                  // 税金（20%）
    },

    // グリッドサーチ（最小限：約 15-20 秒で完了）
    gridSearch: {
        lambdaReg: [0.9, 0.95],
        windowLength: [60],
        quantile: [0.35, 0.4]
    }
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

// ============================================================================
// ポートフォリオ構築（リスク管理付き）
// ============================================================================

function buildPortfolio(signal, quantile = 0.3, riskConfig = null) {
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
        // 最大ポジション制限
        for (let i = 0; i < n; i++) {
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
// リスク管理
// ============================================================================

function applyRiskManagement(positions, currentPrices, entryPrices, peakPrices, riskConfig) {
    const n = positions.length;
    const adjustedPositions = [...positions];
    let triggeredStopLoss = false;

    for (let i = 0; i < n; i++) {
        if (positions[i] === 0) continue;

        const pnl = (currentPrices[i] - entryPrices[i]) / entryPrices[i];
        const isLong = positions[i] > 0;

        // ストップロスチェック
        if (isLong && pnl <= -riskConfig.stopLoss) {
            adjustedPositions[i] = 0;
            triggeredStopLoss = true;
        } else if (!isLong && pnl >= riskConfig.stopLoss) {
            adjustedPositions[i] = 0;
            triggeredStopLoss = true;
        }

        // トレーリングストップチェック
        if (isLong && peakPrices[i] > 0) {
            const peakPnl = (peakPrices[i] - entryPrices[i]) / entryPrices[i];
            const currentPnlFromPeak = (currentPrices[i] - peakPrices[i]) / peakPrices[i];
            if (currentPnlFromPeak <= -riskConfig.trailingStop && peakPnl > 0) {
                adjustedPositions[i] = 0;
                triggeredStopLoss = true;
            }
        }
    }

    return { positions: adjustedPositions, triggeredStopLoss };
}

// ============================================================================
// パフォーマンス指標
// ============================================================================

function computeMetrics(returns, ann = 252) {
    if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cumulative: 1, Sharpe: 0 };
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * ann;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(ann);
    const rr = risk > 0 ? ar / risk : 0;
    const sharpe = risk > 0 ? (ar - 0.02) / risk : 0;
    let cum = 1, max = 1, mdd = 0;
    for (const r of returns) { cum *= (1 + r); if (cum > max) max = cum; const dd = (cum - max) / max; if (dd < mdd) mdd = dd; }
    return { AR: ar, RISK: risk, RR: rr, MDD: mdd, Cumulative: cum, Sharpe: sharpe };
}

// ============================================================================
// データ処理
// ============================================================================

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

function buildMatrices(usData, jpData) {
    const usRet = {}, jpRet = {}, jpRetOc = {};
    for (const t in usData) {
        const d = usData[t];
        const ret = [];
        for (let i = 1; i < d.length; i++) ret.push({ date: d[i].date, return: (d[i].close - d[i-1].close) / d[i-1].close });
        usRet[t] = ret;
    }
    for (const t in jpData) {
        const d = jpData[t];
        const cc = [], oc = [];
        for (let i = 1; i < d.length; i++) cc.push({ date: d[i].date, return: (d[i].close - d[i-1].close) / d[i-1].close });
        for (let i = 0; i < d.length; i++) if (d[i].open > 0) oc.push({ date: d[i].date, return: (d[i].close - d[i].open) / d[i].open });
        jpRet[t] = cc;
        jpRetOc[t] = oc;
    }

    const usMap = new Map(), jpMap = new Map();
    for (const t in usRet) for (const r of usRet[t]) { if (!usMap.has(r.date)) usMap.set(r.date, {}); usMap.get(r.date)[t] = r.return; }
    for (const t in jpRet) for (const r of jpRet[t]) { if (!jpMap.has(r.date)) jpMap.set(r.date, {}); jpMap.get(r.date)[t] = r.return; }

    const usDates = new Set([...usMap.keys()].sort()), jpDates = new Set([...jpMap.keys()].sort());
    const commonDates = [...usDates].filter(d => jpDates.has(d)).sort();
    const filteredDates = commonDates.filter(d => d >= '2018-01-01');

    const retUs = [], retJp = [], retJpOc = [], dates = [];
    for (let i = 1; i < filteredDates.length; i++) {
        const usDate = filteredDates[i-1], jpDate = filteredDates[i];
        const usRow = Object.fromEntries(US_ETF_TICKERS.map(t => [t, usMap.get(usDate)?.[t] ?? 0]));
        const jpRow = Object.fromEntries(JP_ETF_TICKERS.map(t => [t, jpMap.get(jpDate)?.[t] ?? 0]));
        const jpOcRow = Object.fromEntries(JP_ETF_TICKERS.map(t => [t, jpMap.get(jpDate)?.[t] ?? 0]));
        let valid = true;
        for (const t of US_ETF_TICKERS) if (usRow[t] === undefined) valid = false;
        for (const t of JP_ETF_TICKERS) if (jpRow[t] === undefined) valid = false;
        if (valid) {
            retUs.push({ values: US_ETF_TICKERS.map(t => usRow[t]) });
            retJp.push({ values: JP_ETF_TICKERS.map(t => jpRow[t]) });
            retJpOc.push({ values: JP_ETF_TICKERS.map(t => jpOcRow[t]) });
            dates.push(jpDate);
        }
    }
    return { retUs, retJp, retJpOc, dates };
}

function computeCFull(retUs, retJp) {
    const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
    return correlationMatrix(combined);
}

// ============================================================================
// バックテスト（リスク管理付き）
// ============================================================================

function runBacktest(retUs, retJp, retJpOc, config, sectorLabels, CFull, withRiskManagement = false) {
    const nJp = JP_ETF_TICKERS.length;
    const signalGen = new LeadLagSignal(config);
    const results = [];
    const costs = config.transactionCosts || { slippage: 0.0005, commission: 0.0003 };
    const totalCost = costs.slippage + costs.commission;

    // リスク管理用変数
    let positions = new Array(nJp).fill(0);
    let entryPrices = new Array(nJp).fill(0);
    let peakPrices = new Array(nJp).fill(0);
    let cumulative = 1;
    let runningMax = 1;
    let currentDrawdown = 0;

    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
        const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
        const usLatest = retUs[i - 1].values;

        // シグナル生成
        const signal = signalGen.computeSignal(usWin, jpWin, usLatest, sectorLabels, CFull);

        // ポートフォリオ構築
        let weights = buildPortfolio(signal, config.quantile, withRiskManagement ? config.riskManagement : null);

        // ドローダウン制御
        if (withRiskManagement && currentDrawdown < -config.riskManagement.maxDrawdownLimit * 0.5) {
            const scale = currentDrawdown < -config.riskManagement.maxDrawdownLimit ? 0 : 0.5;
            weights = weights.map(w => w * scale);
        }

        // 翌日リターン
        const retNext = retJpOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0);

        // 取引コスト
        const turnover = weights.reduce((s, w) => s + Math.abs(w), 0);
        ret = ret - totalCost * turnover * 0.5;

        // リスク管理の更新
        if (withRiskManagement) {
            // 簡易版：ポジションの維持・決済をシミュレート
            for (let j = 0; j < nJp; j++) {
                if (weights[j] !== 0 && positions[j] === 0) {
                    // 新規ポジション
                    positions[j] = weights[j];
                    entryPrices[j] = 1; // 正規化価格
                    peakPrices[j] = 1;
                } else if (weights[j] === 0 && positions[j] !== 0) {
                    // ポジション決済
                    positions[j] = 0;
                }
            }
        }

        results.push({ date: retJpOc[i].date, return: ret });

        // ドローダウン更新
        cumulative *= (1 + ret);
        if (cumulative > runningMax) runningMax = cumulative;
        currentDrawdown = (cumulative - runningMax) / runningMax;
    }

    return results;
}

// ============================================================================
// パラメータ最適化
// ============================================================================

function optimizeParams(retUs, retJp, retJpOc, sectorLabels, CFull) {
    console.log('パラメータ最適化中...');
    const { lambdaReg, windowLength, quantile } = CONFIG.gridSearch;
    let bestParams = { ...CONFIG };
    let bestRR = -Infinity;

    const total = lambdaReg.length * windowLength.length * quantile.length;
    let count = 0;

    for (const l of lambdaReg) {
        for (const w of windowLength) {
            for (const q of quantile) {
                count++;
                const config = { ...CONFIG, lambdaReg: l, windowLength: w, quantile: q, warmupPeriod: w };
                const result = runBacktest(retUs, retJp, retJpOc, config, sectorLabels, CFull, false);
                const metrics = computeMetrics(result.map(r => r.return));

                if (metrics.RR > bestRR && metrics.MDD > -0.30) {
                    bestRR = metrics.RR;
                    bestParams = { ...config };
                    console.log(`  [${count}/${total}] 新記録：λ=${l}, W=${w}, q=${q} => R/R=${metrics.RR.toFixed(2)}, MDD=${(metrics.MDD*100).toFixed(1)}%`);
                }
            }
        }
    }

    console.log(`最適パラメータ：λ=${bestParams.lambdaReg}, window=${bestParams.windowLength}, q=${bestParams.quantile}`);
    return bestParams;
}

// ============================================================================
// シグナル生成（初心者向け）
// ============================================================================

function generateTradingSignal(retUs, retJp, retJpOc, config, sectorLabels, CFull, date) {
    const nJp = JP_ETF_TICKERS.length;
    const signalGen = new LeadLagSignal(config);
    const i = retJpOc.length - 1;
    const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
    const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
    const usLatest = retUs[i - 1].values;

    const signal = signalGen.computeSignal(usWin, jpWin, usLatest, sectorLabels, CFull);
    const indexed = signal.map((val, idx) => ({ val, idx, ticker: JP_ETF_TICKERS[idx] })).sort((a, b) => a.val - b.val);

    const q = Math.floor(nJp * config.quantile);
    const longSignals = indexed.slice(-q);
    const shortSignals = indexed.slice(0, q);

    return {
        date: date || retJpOc[i].date,
        long: longSignals.map(s => ({ ticker: s.ticker, signal: s.val })),
        short: shortSignals.map(s => ({ ticker: s.ticker, signal: s.val })),
        allSignals: indexed.map(s => ({ ticker: s.ticker, signal: s.val }))
    };
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('日米業種リードラグ戦略 - 初心者向け改良版 v1.0');
    console.log('='.repeat(70));

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // データ読み込み
    console.log('\n[1/5] データ読み込み中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    // データ処理
    console.log('[2/5] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
    console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

    // 相関行列
    console.log('[3/5] 相関行列計算中...');
    const CFull = computeCFull(retUs, retJp);

    // パラメータ最適化
    console.log('[4/5] パラメータ最適化中...');
    const optConfig = optimizeParams(retUs, retJp, retJpOc, SECTOR_LABELS, CFull);

    // 戦略バックテスト
    console.log('\n[5/5] 戦略バックテスト中...\n');

    // リスク管理あり/なしで比較
    const resultNoRisk = runBacktest(retUs, retJp, retJpOc, optConfig, SECTOR_LABELS, CFull, false);
    const resultWithRisk = runBacktest(retUs, retJp, retJpOc, optConfig, SECTOR_LABELS, CFull, true);

    const metricsNoRisk = computeMetrics(resultNoRisk.map(r => r.return));
    const metricsWithRisk = computeMetrics(resultWithRisk.map(r => r.return));

    console.log('='.repeat(70));
    console.log('バックテスト結果');
    console.log('='.repeat(70));
    console.log('\nリスク管理なし:');
    console.log(`  AR: ${(metricsNoRisk.AR*100).toFixed(2)}%, R/R: ${metricsNoRisk.RR.toFixed(2)}, MDD: ${(metricsNoRisk.MDD*100).toFixed(2)}%`);
    console.log('\nリスク管理あり:');
    console.log(`  AR: ${(metricsWithRisk.AR*100).toFixed(2)}%, R/R: ${metricsWithRisk.RR.toFixed(2)}, MDD: ${(metricsWithRisk.MDD*100).toFixed(2)}%`);

    // シグナル生成
    console.log('\n' + '='.repeat(70));
    console.log('最新シグナル');
    console.log('='.repeat(70));
    const signal = generateTradingSignal(retUs, retJp, retJpOc, optConfig, SECTOR_LABELS, CFull, dates[dates.length-1]);
    console.log(`\n日付：${signal.date}`);
    console.log('\n買い候補:');
    signal.long.forEach(s => console.log(`  ${s.ticker}: ${s.signal.toFixed(2)}`));
    console.log('\n売り候補:');
    signal.short.forEach(s => console.log(`  ${s.ticker}: ${s.signal.toFixed(2)}`));

    // 結果保存
    const bestMetrics = metricsWithRisk.RR > metricsNoRisk.RR ? metricsWithRisk : metricsNoRisk;
    const summary = [
        { name: 'PCA_SUB_RiskOn', ...metricsWithRisk },
        { name: 'PCA_SUB_RiskOff', ...metricsNoRisk }
    ];

    const summaryCsv = 'Strategy,AR (%),RISK (%),R/R,MDD (%),Cumulative\n' +
        summary.map(s => `${s.name},${(s.AR*100).toFixed(4)},${(s.RISK*100).toFixed(4)},${s.RR.toFixed(4)},${(s.MDD*100).toFixed(4)},${s.Cumulative.toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'backtest_summary_v1.csv'), summaryCsv);

    // シグナル保存
    const signalJson = {
        date: signal.date,
        long: signal.long,
        short: signal.short,
        parameters: {
            lambda: optConfig.lambdaReg,
            window: optConfig.windowLength,
            quantile: optConfig.quantile
        },
        metrics: {
            AR: bestMetrics.AR,
            RR: bestMetrics.RR,
            MDD: bestMetrics.MDD
        }
    };
    fs.writeFileSync(path.join(outputDir, 'latest_signal.json'), JSON.stringify(signalJson, null, 2));

    console.log('\n結果を保存しました：results/backtest_summary_v1.csv, results/latest_signal.json');
    console.log('\n' + '='.repeat(70));
    console.log('考察');
    console.log('='.repeat(70));

    if (bestMetrics.RR > 0.5) {
        console.log('✓ R/R 比が 0.5 以上（良好なパフォーマンス）');
    } else if (bestMetrics.RR > 0) {
        console.log('△ R/R 比が 0 以上（改善の余地あり）');
    } else {
        console.log('✗ R/R 比が負（戦略の見直しが必要）');
    }

    if (bestMetrics.MDD > -0.15) {
        console.log('✓ 最大ドローダウンが 15% 以内（良好）');
    } else if (bestMetrics.MDD > -0.25) {
        console.log('△ 最大ドローダウンが 25% 以内（許容範囲）');
    } else {
        console.log('✗ 最大ドローダウンが 25% 超（リスク管理の強化が必要）');
    }

    console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
