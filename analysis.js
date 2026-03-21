/**
 * 戦略分析ツール - フェーズ 1: 現状分析
 * 過去パフォーマンスの詳細分析と課題特定
 */

const fs = require('fs');
const path = require('path');

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

// 簡易版線形代数関数（backtest_improved.js から移植）
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

// データ読み込み
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

// リターン計算
function computeReturns(data) {
    const cc = [], oc = [];
    for (let i = 1; i < data.length; i++) {
        cc.push({ date: data[i].date, return: (data[i].close - data[i-1].close) / data[i-1].close });
    }
    for (let i = 0; i < data.length; i++) {
        if (data[i].open > 0) oc.push({ date: data[i].date, return: (data[i].close - data[i].open) / data[i].open });
    }
    return { cc, oc };
}

// 行列構築
function buildMatrices(usData, jpData) {
    const usRet = {}, jpRet = {}, jpRetOc = {};
    for (const t in usData) usRet[t] = computeReturns(usData[t]).cc;
    for (const t in jpData) {
        jpRet[t] = computeReturns(jpData[t]).cc;
        jpRetOc[t] = computeReturns(jpData[t]).oc;
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

// パフォーマンス指標
function computeMetrics(returns) {
    if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cumulative: 1, Sharpe: 0 };
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
    const rr = risk > 0 ? ar / risk : 0;
    const sharpe = risk > 0 ? (ar - 0.02) / risk : 0; // リスクフリーレート 2%
    let cum = 1, max = 1, mdd = 0;
    for (const r of returns) { cum *= (1 + r); if (cum > max) max = cum; const dd = (cum - max) / max; if (dd < mdd) mdd = dd; }
    return { AR: ar, RISK: risk, RR: rr, MDD: mdd, Cumulative: cum, Sharpe: sharpe };
}

// 年別パフォーマンス
function yearlyPerformance(results) {
    const byYear = {};
    for (const r of results) {
        if (!r.date) continue;
        const y = r.date.slice(0, 4);
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(r.return);
    }
    return Object.fromEntries(Object.entries(byYear).map(([y, rets]) => [y, computeMetrics(rets)]));
}

// 四半期別パフォーマンス
function quarterlyPerformance(results) {
    const byQuarter = {};
    for (const r of results) {
        if (!r.date) continue;
        const y = r.date.slice(0, 4);
        const m = parseInt(r.date.slice(5, 7));
        const q = `Q${Math.ceil(m / 3)}`;
        const key = `${y}-${q}`;
        if (!byQuarter[key]) byQuarter[key] = [];
        byQuarter[key].push(r.return);
    }
    return Object.fromEntries(Object.entries(byQuarter).map(([q, rets]) => [q, computeMetrics(rets)]));
}

// 市場環境別パフォーマンス（強気・弱気）
function regimePerformance(results, dates) {
    // 単純な定義：年初来リターンが正なら強気、負なら弱気
    const bullResults = [], bearResults = [];
    let ytdReturn = 0;
    
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r.date) continue;
        
        const date = r.date;
        const month = parseInt(date.slice(5, 7));
        
        if (month === 1) ytdReturn = 0; // 年初リセット
        
        if (ytdReturn >= 0) {
            bullResults.push(r.return);
        } else {
            bearResults.push(r.return);
        }
        
        ytdReturn += r.return;
    }
    
    return {
        bull: computeMetrics(bullResults),
        bear: computeMetrics(bearResults),
        bullDays: bullResults.length,
        bearDays: bearResults.length
    };
}

// シグナル分析（簡易版）
function analyzeSignals(retUs, retJp, retJpOc, dates, config, sectorLabels, CFull) {
    const nJp = JP_ETF_TICKERS.length;
    const signalCounts = { correct: 0, incorrect: 0 };
    const signalBySector = {};
    
    // 簡易版シグナル生成（実際の実装とは異なる可能性あり）
    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
        const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
        const usLatest = retUs[i - 1].values;
        
        // 簡易シグナル：米国最新リターンの符号を日本に伝播
        const simpleSignal = usLatest.map((x, j) => x);
        
        // 翌日リターン
        const retNext = retJpOc[i].values;
        
        // 符号が一致したか
        for (let j = 0; j < nJp; j++) {
            const predicted = simpleSignal[j] > 0 ? 1 : -1;
            const actual = retNext[j] > 0 ? 1 : -1;
            
            if (predicted === actual) {
                signalCounts.correct++;
            } else {
                signalCounts.incorrect++;
            }
        }
    }
    
    const accuracy = signalCounts.correct / (signalCounts.correct + signalCounts.incorrect);
    return { accuracy, ...signalCounts };
}

// メイン分析
async function main() {
    console.log('='.repeat(70));
    console.log('戦略分析ツール - フェーズ 1: 現状分析');
    console.log('='.repeat(70));
    
    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    // データ読み込み
    console.log('\n[1/5] データ読み込み中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
    
    // 行列構築
    console.log('[2/5] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildMatrices(usData, jpData);
    console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);
    
    // 相関行列
    console.log('[3/5] 相関行列計算中...');
    const CFull = correlationMatrix(retUs.map((r, i) => [...retUs[i].values, ...retJp[i].values]));
    
    // 設定
    const CONFIG = {
        windowLength: 60,
        nFactors: 3,
        lambdaReg: 0.9,
        quantile: 0.4,
        warmupPeriod: 60,
        transactionCosts: { slippage: 0.001, commission: 0.0005 }
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
    
    // 簡易バックテスト（分析用）
    console.log('[4/5] 簡易バックテスト中...');
    const nJp = JP_ETF_TICKERS.length;
    const results = [];
    
    for (let i = CONFIG.warmupPeriod; i < retJpOc.length; i++) {
        const usWin = retUs.slice(i - CONFIG.windowLength, i).map(r => r.values);
        const jpWin = retJp.slice(i - CONFIG.windowLength, i).map(r => r.values);
        const usLatest = retUs[i - 1].values;
        
        // 簡易シグナル：米国最新リターン
        const signal = usLatest;
        
        // ポートフォリオ構築
        const q = Math.floor(nJp * CONFIG.quantile);
        const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
        const longIdx = indexed.slice(-q).map(x => x.idx);
        const shortIdx = indexed.slice(0, q).map(x => x.idx);
        
        const weights = new Array(nJp).fill(0);
        for (const idx of longIdx) weights[idx] = 1.0 / q;
        for (const idx of shortIdx) weights[idx] = -1.0 / q;
        
        // 翌日リターン
        const retNext = retJpOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0);
        
        // 取引コスト
        ret = ret - (CONFIG.transactionCosts.slippage + CONFIG.transactionCosts.commission);
        
        results.push({ date: retJpOc[i].date, return: ret });
    }
    
    // 分析結果
    console.log('\n[5/5] 分析結果...\n');
    
    const metrics = computeMetrics(results.map(r => r.return));
    console.log('='.repeat(70));
    console.log('全体パフォーマンス');
    console.log('='.repeat(70));
    console.log(`年率リターン (AR): ${(metrics.AR * 100).toFixed(2)}%`);
    console.log(`年率リスク (RISK): ${(metrics.RISK * 100).toFixed(2)}%`);
    console.log(`リスク・リターン比 (R/R): ${metrics.RR.toFixed(2)}`);
    console.log(`シャープレシオ: ${metrics.Sharpe.toFixed(2)}`);
    console.log(`最大ドローダウン (MDD): ${(metrics.MDD * 100).toFixed(2)}%`);
    console.log(`累積リターン: ${(metrics.Cumulative * 100).toFixed(2)}%`);
    
    // 年別パフォーマンス
    console.log('\n' + '='.repeat(70));
    console.log('年別パフォーマンス');
    console.log('='.repeat(70));
    const yearly = yearlyPerformance(results);
    console.log('Year'.padEnd(8) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10) + 'Sharpe'.padStart(10));
    console.log('-'.repeat(50));
    for (const [y, m] of Object.entries(yearly).sort()) {
        console.log(y.padEnd(8) + (m.AR*100).toFixed(2).padStart(10) + m.RR.toFixed(2).padStart(10) + (m.MDD*100).toFixed(2).padStart(10) + m.Sharpe.toFixed(2).padStart(10));
    }
    
    // 四半期別パフォーマンス
    console.log('\n' + '='.repeat(70));
    console.log('四半期別パフォーマンス');
    console.log('='.repeat(70));
    const quarterly = quarterlyPerformance(results);
    console.log('Quarter'.padEnd(10) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10));
    console.log('-'.repeat(50));
    for (const [q, m] of Object.entries(quarterly).sort()) {
        console.log(q.padEnd(10) + (m.AR*100).toFixed(2).padStart(10) + m.RR.toFixed(2).padStart(10) + (m.MDD*100).toFixed(2).padStart(10));
    }
    
    // 市場環境別パフォーマンス
    console.log('\n' + '='.repeat(70));
    console.log('市場環境別パフォーマンス');
    console.log('='.repeat(70));
    const regime = regimePerformance(results, dates);
    console.log(`強気相場 (${regime.bullDays}日): AR=${(regime.bull.AR*100).toFixed(2)}%, R/R=${regime.bull.RR.toFixed(2)}`);
    console.log(`弱気相場 (${regime.bearDays}日): AR=${(regime.bear.AR*100).toFixed(2)}%, R/R=${regime.bear.RR.toFixed(2)}`);
    
    // シグナル精度
    console.log('\n' + '='.repeat(70));
    console.log('シグナル精度（簡易版）');
    console.log('='.repeat(70));
    const signalAnalysis = analyzeSignals(retUs, retJp, retJpOc, dates, CONFIG, SECTOR_LABELS, CFull);
    console.log(`正解率: ${(signalAnalysis.accuracy * 100).toFixed(1)}%`);
    console.log(`正解: ${signalAnalysis.correct}回，誤り：${signalAnalysis.incorrect}回`);
    
    // 結果保存
    const analysisReport = {
        summary: metrics,
        yearly: yearly,
        quarterly: quarterly,
        regime: regime,
        signalAccuracy: signalAnalysis,
        analysisDate: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(outputDir, 'analysis_report.json'),
        JSON.stringify(analysisReport, null, 2)
    );
    
    // 年別 CSV
    const yearlyCsv = 'Year,AR (%),RISK (%),R/R,MDD (%),Sharpe\n' +
        Object.entries(yearly).map(([y, m]) =>
            `${y},${(m.AR*100).toFixed(4)},${(m.RISK*100).toFixed(4)},${m.RR.toFixed(4)},${(m.MDD*100).toFixed(4)},${m.Sharpe.toFixed(4)}`
        ).join('\n');
    fs.writeFileSync(path.join(outputDir, 'yearly_performance.csv'), yearlyCsv);
    
    console.log('\n分析結果を保存しました：results/analysis_report.json');
    console.log('\n' + '='.repeat(70));
    console.log('考察');
    console.log('='.repeat(70));
    
    // 自動考察
    const issues = [];
    if (metrics.RR < 0) issues.push('✗ R/R 比が負（戦略が機能していない）');
    else if (metrics.RR < 0.3) issues.push('△ R/R 比が 0.3 未満（改善の余地あり）');
    else issues.push('✓ R/R 比が 0.3 以上（良好）');
    
    if (metrics.MDD < -0.25) issues.push('✗ 最大ドローダウンが -25% 未満（リスク大きすぎ）');
    else if (metrics.MDD < -0.15) issues.push('△ 最大ドローダウンが -15% 未満（改善の余地あり）');
    else issues.push('✓ 最大ドローダウンが -15% 以内（良好）');
    
    const bestYear = Object.entries(yearly).reduce((a, b) => a[1].AR > b[1].AR ? a : b);
    const worstYear = Object.entries(yearly).reduce((a, b) => a[1].AR < b[1].AR ? a : b);
    
    console.log('\n【戦略評価】');
    issues.forEach(i => console.log(`  ${i}`));
    
    console.log(`\n【年別推移】`);
    console.log(`  最良年：${bestYear[0]} (AR: ${(bestYear[1].AR*100).toFixed(2)}%)`);
    console.log(`  最悪年：${worstYear[0]} (AR: ${(worstYear[1].AR*100).toFixed(2)}%)`);
    
    console.log(`\n【市場環境】`);
    console.log(`  強気相場でのパフォーマンス：${regime.bull.RR > 0 ? '良好' : '不良'}`);
    console.log(`  弱気相場でのパフォーマンス：${regime.bear.RR > 0 ? '良好' : '不良'}`);
    
    console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
