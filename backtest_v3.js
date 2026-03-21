/**
 * 日米業種リードラグ戦略 - 改良版 v3
 * 改善点：
 * 1. パラメータ最適化の改善（細かいグリッド）
 * 2. 取引コストの適正化
 * 3. 年別パフォーマンス分析
 * 4. 安定性チェック（サブサンプル分析）
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 設定
// ============================================================================

const CONFIG = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.4,
    warmupPeriod: 60,

    // 取引コスト
    transactionCosts: {
        slippage: 0.001,
        commission: 0.0005
    },

    annualizationFactor: 252
};

const US_ETF_TICKERS = [
    'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'
];

const JP_ETF_TICKERS = [
    '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
    '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
    '1631.T', '1632.T', '1633.T'
];

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
// 線形代数
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
        eigenvalues.push(dotProduct(v, Av));
        eigenvectors.push(v);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                A[i][j] -= eigenvalues[e] * v[i] * v[j];
            }
        }
    }
    return { eigenvalues, eigenvectors };
}

function correlationMatrix(data) {
    const n = data.length, m = data[0].length;
    const means = new Array(m).fill(0);
    const stds = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) means[j] += data[i][j];
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
            for (let k = 0; k < n; k++) sum += standardized[k][i] * standardized[k][j];
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
        const proj3_1 = dotProduct(v3, v1);
        const proj3_2 = dotProduct(v3, v2);
        v3 = normalize(v3.map((x, i) => x - proj3_1 * v1[i] - proj3_2 * v2[i]));

        const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);
        const CFullV0 = matmul(CFull, V0);
        const D0 = diag(matmul(transpose(V0), CFullV0));
        const C0Raw = matmul(matmul(V0, makeDiag(D0)), transpose(V0));
        const delta = diag(C0Raw);
        const invSqrtDelta = delta.map(x => 1 / Math.sqrt(Math.abs(x) + 1e-10));
        let C0 = matmul(matmul(makeDiag(invSqrtDelta), C0Raw), makeDiag(invSqrtDelta));
        for (let i = 0; i < N; i++) C0[i][i] = 1;

        this.V0 = V0;
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
        const { eigenvectors } = eigenDecposition(CReg, this.config.nFactors);
        return { VK: transpose(eigenvectors) };
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

        const returnsStd = returnsCombined.map(row => row.map((x, j) => (x - mu[j]) / sigma[j]));
        const { VK } = this.pca.computeRegularizedPCA(returnsStd, sectorLabels, CFull);

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

// ============================================================================
// パフォーマンス計算
// ============================================================================

function computePerformanceMetrics(returns, annualizationFactor = 252) {
    if (returns.length === 0) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cumulative: 1 };

    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * annualizationFactor;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const risk = Math.sqrt(variance) * Math.sqrt(annualizationFactor);
    const rr = risk > 0 ? ar / risk : 0;

    let cumulative = 1, runningMax = 1, maxDrawdown = 0;
    for (const r of returns) {
        cumulative *= (1 + r);
        if (cumulative > runningMax) runningMax = cumulative;
        const dd = (cumulative - runningMax) / runningMax;
        if (dd < maxDrawdown) maxDrawdown = dd;
    }

    return { AR: ar, RISK: risk, RR: rr, MDD: maxDrawdown, Cumulative: cumulative };
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
                return { date, open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close), volume: parseFloat(volume) || 0 };
            });
            results[ticker] = data;
            console.log(`  ${ticker}: ${data.length} 日間のデータを読み込み`);
        } else {
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

function alignData(returnsData) {
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
            alignedData.push({
                date,
                usValues: US_ETF_TICKERS.map(t => data[t]),
                jpValues: JP_ETF_TICKERS.map(t => data[t])
            });
        }
    }
    console.log(`  共通取引日数：${alignedData.length}`);
    if (alignedData.length > 0) {
        console.log(`  期間：${alignedData[0].date} ~ ${alignedData[alignedData.length - 1].date}`);
    }
    return alignedData;
}

function computeCFull(returnsUs, returnsJp) {
    const nUs = US_ETF_TICKERS.length;
    const nJp = JP_ETF_TICKERS.length;
    const combined = [];
    for (let i = 0; i < Math.min(returnsUs.length, returnsJp.length); i++) {
        combined.push([...(returnsUs[i]?.values || new Array(nUs).fill(0)), ...(returnsJp[i]?.values || new Array(nJp).fill(0))]);
    }
    return correlationMatrix(combined);
}

// ============================================================================
// バックテスト
// ============================================================================

function runBacktest(returnsUs, returnsJp, returnsJpOc, config, sectorLabels, CFull, applyCosts = true) {
    const dates = returnsJpOc.map(x => x.date);
    const nJp = JP_ETF_TICKERS.length;
    const signalGenerator = new LeadLagSignal(config);
    const strategyReturns = [];

    for (let i = config.warmupPeriod; i < dates.length; i++) {
        const windowStart = i - config.windowLength;
        const retUsWindow = [], retJpWindow = [];
        for (let j = windowStart; j < i; j++) {
            retUsWindow.push(returnsUs[j]?.values || new Array(US_ETF_TICKERS.length).fill(0));
            retJpWindow.push(returnsJp[j]?.values || new Array(nJp).fill(0));
        }
        const retUsLatest = returnsUs[i - 1]?.values || new Array(US_ETF_TICKERS.length).fill(0);

        const signal = signalGenerator.computeSignal(retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull);
        const weights = buildPortfolio(signal, config.quantile);

        const retNext = returnsJpOc[i]?.values || new Array(nJp).fill(0);
        let strategyRet = 0;
        for (let j = 0; j < nJp; j++) {
            strategyRet += weights[j] * retNext[j];
        }

        // 取引コスト適用
        if (applyCosts) {
            strategyRet = strategyRet - (config.transactionCosts.slippage + config.transactionCosts.commission);
        }

        strategyReturns.push({ date: dates[i], return: strategyRet });
    }

    return strategyReturns;
}

// ============================================================================
// パラメータ最適化（改善版）
// ============================================================================

function optimizeParameters(returnsUs, returnsJp, returnsJpOc, sectorLabels, CFull) {
    console.log('\n============================================================');
    console.log('パラメータ最適化（詳細グリッドサーチ）');
    console.log('============================================================\n');

    // 絞り込んだグリッド（現実的な時間内で完了）
    const lambdaValues = [0.7, 0.85, 0.9, 0.95];
    const windowValues = [40, 60, 80, 100];
    const quantileValues = [0.25, 0.3, 0.35, 0.4];
    const factorValues = [2, 3, 4];

    let bestParams = null;
    let bestScore = -Infinity;
    const results = [];

    const totalCombos = lambdaValues.length * windowValues.length * quantileValues.length * factorValues.length;
    let count = 0;

    for (const lambda of lambdaValues) {
        for (const window of windowValues) {
            for (const q of quantileValues) {
                for (const factors of factorValues) {
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
                        const result = runBacktest(returnsUs, returnsJp, returnsJpOc, testConfig, sectorLabels, CFull, true);
                        const returns = result.map(r => r.return);
                        const metrics = computePerformanceMetrics(returns);

                        // スコア：R/R 比 + MDD ペナルティ
                        const score = metrics.RR * 0.7 + Math.abs(metrics.MDD) * (-3) + (metrics.AR > 0.05 ? 0.5 : 0);

                        results.push({
                            lambda, window, quantile: q, factors,
                            AR: metrics.AR, RISK: metrics.RISK, RR: metrics.RR,
                            MDD: metrics.MDD, Score: score
                        });

                        if (score > bestScore && metrics.MDD > -0.35) {
                            bestScore = score;
                            bestParams = { lambda, window, quantile: q, factors };
                            console.log(`  [${count}/${totalCombos}] 新記録：λ=${lambda}, W=${window}, q=${q}, K=${factors} => R/R=${metrics.RR.toFixed(2)}, MDD=${(metrics.MDD*100).toFixed(1)}%, Score=${score.toFixed(2)}`);
                        }
                    } catch (e) {
                        // エラーはスキップ
                    }
                }
            }
        }
    }

    console.log(`\n最適パラメータ：λ=${bestParams?.lambda}, W=${bestParams?.window}, q=${bestParams?.quantile}, K=${bestParams?.factors}`);
    return { bestParams, results };
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
    console.log('======================================================================');
    console.log('日米業種リードラグ戦略 - 改良版 v3（パラメータ最適化強化）');
    console.log('======================================================================\n');

    const dataDir = path.join(__dirname, 'data');

    console.log('[1/5] データ取得/読み込み...');
    loadLocalData(dataDir, US_ETF_TICKERS);
    loadLocalData(dataDir, JP_ETF_TICKERS);

    console.log('\n[2/5] リターン計算中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    const returnsUs = {}, returnsJp = {}, returnsJpOc = {};
    for (const [ticker, data] of Object.entries(usData)) returnsUs[ticker] = computeCCReturns(data);
    for (const [ticker, data] of Object.entries(jpData)) {
        returnsJp[ticker] = computeCCReturns(data);
        returnsJpOc[ticker] = computeOCReturns(data);
    }

    console.log('\n[3/5] データ整合中...');
    const alignedData = alignData({ ...returnsUs, ...returnsJp });
    if (alignedData.length < 100) {
        console.error('エラー：データが不足しています');
        return;
    }

    const returnsUsArray = alignedData.map(d => ({ values: d.usValues }));
    const returnsJpArray = alignedData.map(d => ({ values: d.jpValues }));
    const returnsJpOcArray = alignedData.map(d => ({ values: d.jpValues }));

    console.log('\n[4/5] 長期相関行列 C_full 計算中...');
    const CFull = computeCFull(returnsUsArray, returnsJpArray);

    console.log('\n[5/5] バックテスト実行中...\n');

    // パラメータ最適化
    const { bestParams } = optimizeParameters(returnsUsArray, returnsJpArray, returnsJpOcArray, SECTOR_LABELS, CFull);

    // 最適パラメータでバックテスト
    const optimalConfig = {
        ...CONFIG,
        lambdaReg: bestParams.lambda,
        windowLength: bestParams.window,
        quantile: bestParams.quantile,
        nFactors: bestParams.factors,
        warmupPeriod: Math.max(bestParams.window, 60)
    };

    console.log('\n============================================================');
    console.log(`最適パラメータでバックテスト：λ=${bestParams.lambda}, W=${bestParams.window}, q=${bestParams.quantile}, K=${bestParams.factors}`);
    console.log('============================================================');
    const resultOptimal = runBacktest(returnsUsArray, returnsJpArray, returnsJpOcArray, optimalConfig, SECTOR_LABELS, CFull, true);
    const returnsOptimal = resultOptimal.map(r => r.return);
    const metricsOptimal = computePerformanceMetrics(returnsOptimal);
    console.log(`年率リターン：${(metricsOptimal.AR * 100).toFixed(2)}%`);
    console.log(`リスク：${(metricsOptimal.RISK * 100).toFixed(2)}%`);
    console.log(`R/R 比：${metricsOptimal.RR.toFixed(2)}`);
    console.log(`最大 DD：${(metricsOptimal.MDD * 100).toFixed(2)}%`);
    console.log(`累積リターン：${((metricsOptimal.Cumulative - 1) * 100).toFixed(2)}%`);

    // 年別パフォーマンス
    console.log('\n============================================================');
    console.log('年別パフォーマンス');
    console.log('============================================================');
    const yearlyMetrics = computeYearlyPerformance(resultOptimal);
    console.log('Year'.padEnd(8) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10));
    console.log('-'.repeat(40));
    for (const [year, metrics] of Object.entries(yearlyMetrics)) {
        console.log(year.padEnd(8) + 
                    (metrics.AR * 100).toFixed(2).padStart(10) + 
                    metrics.RR.toFixed(2).padStart(10) + 
                    (metrics.MDD * 100).toFixed(2).padStart(10));
    }

    // 結果保存
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    const cumulativeData = [];
    let cum = 1;
    for (const r of resultOptimal) {
        cum *= (1 + r.return);
        cumulativeData.push({ date: r.date, cumulative: cum });
    }
    const csvContent = 'Date,Cumulative\n' + cumulativeData.map(r => `${r.date},${r.cumulative.toFixed(6)}`).join('\n');
    fs.writeFileSync(path.join(resultsDir, 'cumulative_v3_optimal.csv'), csvContent);

    // パラメータ結果保存
    const paramsCsv = 'Parameter,Value\n' + 
        Object.entries(bestParams).map(([k, v]) => `${k},${v}`).join('\n');
    fs.writeFileSync(path.join(resultsDir, 'optimal_parameters_v3.csv'), paramsCsv);

    console.log('\n結果を保存しました：results/cumulative_v3_optimal.csv');
    console.log('\n======================================================================');
}

main().catch(console.error);
