/**
 * 戦略分析ツール - フェーズ 1: 現状分析
 * 過去パフォーマンスの詳細分析と課題特定
 */

const fs = require('fs');
const path = require('path');
const { correlationMatrix, LeadLagSignal } = require('./lib/lead_lag_core');
const { buildLeadLagMatrices } = require('./lib/lead_lag_matrices');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('./sector_constants');

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

function buildPortfolio(signal, quantile) {
    const n = signal.length;
    const q = Math.max(1, Math.floor(n * quantile));
    const indexed = signal.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
    const weights = new Array(n).fill(0);
    for (const x of indexed.slice(-q)) weights[x.idx] = 1.0 / q;
    for (const x of indexed.slice(0, q)) weights[x.idx] = -1.0 / q;
    return weights;
}

function computeMetrics(returns) {
    if (!returns.length) return { AR: 0, RISK: 0, RR: 0, MDD: 0, Cumulative: 1, Sharpe: 0 };
    const ar = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const risk = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
    const rr = risk > 0 ? ar / risk : 0;
    const sharpe = risk > 0 ? (ar - 0.02) / risk : 0;
    let cum = 1;
    let max = 1;
    let mdd = 0;
    for (const r of returns) {
        cum *= (1 + r);
        if (cum > max) max = cum;
        const dd = (cum - max) / max;
        if (dd < mdd) mdd = dd;
    }
    return { AR: ar, RISK: risk, RR: rr, MDD: mdd, Cumulative: cum, Sharpe: sharpe };
}

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

function quarterlyPerformance(results) {
    const byQuarter = {};
    for (const r of results) {
        if (!r.date) continue;
        const y = r.date.slice(0, 4);
        const m = parseInt(r.date.slice(5, 7), 10);
        const q = `Q${Math.ceil(m / 3)}`;
        const key = `${y}-${q}`;
        if (!byQuarter[key]) byQuarter[key] = [];
        byQuarter[key].push(r.return);
    }
    return Object.fromEntries(Object.entries(byQuarter).map(([q, rets]) => [q, computeMetrics(rets)]));
}

function regimePerformance(results) {
    const bullResults = [];
    const bearResults = [];
    let ytdReturn = 0;
    let currentYear = null;

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r.date) continue;

        const year = r.date.slice(0, 4);
        if (year !== currentYear) {
            ytdReturn = 0;
            currentYear = year;
        }

        if (ytdReturn >= 0) bullResults.push(r.return);
        else bearResults.push(r.return);

        ytdReturn += r.return;
    }

    return {
        bull: computeMetrics(bullResults),
        bear: computeMetrics(bearResults),
        bullDays: bullResults.length,
        bearDays: bearResults.length,
    };
}

/** 各 JP セクターについて PCA シグナル符号と翌日 OC リターン符号の一致率 */
function analyzeSignals(retUs, retJp, retJpOc, config, sectorLabels, CFull) {
    const nJp = JP_ETF_TICKERS.length;
    const signalCounts = { correct: 0, incorrect: 0 };
    const signalGen = new LeadLagSignal(config);

    for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
        const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
        const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
        const usLatest = retUs[i - 1].values;
        const pcaSignal = signalGen.compute(usWin, jpWin, usLatest, sectorLabels, CFull);
        const retNext = retJpOc[i].values;

        for (let j = 0; j < nJp; j++) {
            const predicted = pcaSignal[j] > 0 ? 1 : -1;
            const actual = retNext[j] > 0 ? 1 : -1;
            if (predicted === actual) signalCounts.correct++;
            else signalCounts.incorrect++;
        }
    }

    const total = signalCounts.correct + signalCounts.incorrect;
    const accuracy = total > 0 ? signalCounts.correct / total : 0;
    return { accuracy, ...signalCounts };
}

async function main() {
    console.log('='.repeat(70));
    console.log('戦略分析ツール - フェーズ 1: 現状分析');
    console.log('='.repeat(70));

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    console.log('\n[1/5] データ読み込み中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    console.log('[2/5] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS, {
        minDate: '2018-01-01',
    });
    console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

    console.log('[3/5] 相関行列計算中...');
    const CFull = correlationMatrix(retUs.map((r, i) => [...retUs[i].values, ...retJp[i].values]));

    const CONFIG = {
        windowLength: 60,
        nFactors: 3,
        lambdaReg: 0.9,
        quantile: 0.4,
        warmupPeriod: 60,
        transactionCosts: { slippage: 0.001, commission: 0.0005 },
    };

    console.log('[4/5] PCA リードラグ・バックテスト中...');
    const nJp = JP_ETF_TICKERS.length;
    const results = [];
    const signalGen = new LeadLagSignal(CONFIG);

    for (let i = CONFIG.warmupPeriod; i < retJpOc.length; i++) {
        const usWin = retUs.slice(i - CONFIG.windowLength, i).map(r => r.values);
        const jpWin = retJp.slice(i - CONFIG.windowLength, i).map(r => r.values);
        const usLatest = retUs[i - 1].values;
        const signal = signalGen.compute(usWin, jpWin, usLatest, SECTOR_LABELS, CFull);
        const weights = buildPortfolio(signal, CONFIG.quantile);
        const retNext = retJpOc[i].values;
        let ret = weights.reduce((s, w, j) => s + w * retNext[j], 0);
        ret -= CONFIG.transactionCosts.slippage + CONFIG.transactionCosts.commission;
        results.push({ date: retJpOc[i].date, return: ret });
    }

    console.log('\n[5/5] 分析結果...\n');

    const metrics = computeMetrics(results.map(r => r.return));
    console.log('='.repeat(70));
    console.log('全体パフォーマンス（PCA SUB + 取引コスト）');
    console.log('='.repeat(70));
    console.log(`年率リターン (AR): ${(metrics.AR * 100).toFixed(2)}%`);
    console.log(`年率リスク (RISK): ${(metrics.RISK * 100).toFixed(2)}%`);
    console.log(`リスク・リターン比 (R/R): ${metrics.RR.toFixed(2)}`);
    console.log(`シャープレシオ: ${metrics.Sharpe.toFixed(2)}`);
    console.log(`最大ドローダウン (MDD): ${(metrics.MDD * 100).toFixed(2)}%`);
    console.log(`累積リターン: ${(metrics.Cumulative * 100).toFixed(2)}%`);

    console.log('\n' + '='.repeat(70));
    console.log('年別パフォーマンス');
    console.log('='.repeat(70));
    const yearly = yearlyPerformance(results);
    console.log('Year'.padEnd(8) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10) + 'Sharpe'.padStart(10));
    console.log('-'.repeat(50));
    for (const [y, m] of Object.entries(yearly).sort()) {
        console.log(
            y.padEnd(8) +
                (m.AR * 100).toFixed(2).padStart(10) +
                m.RR.toFixed(2).padStart(10) +
                (m.MDD * 100).toFixed(2).padStart(10) +
                m.Sharpe.toFixed(2).padStart(10)
        );
    }

    console.log('\n' + '='.repeat(70));
    console.log('四半期別パフォーマンス');
    console.log('='.repeat(70));
    const quarterly = quarterlyPerformance(results);
    console.log('Quarter'.padEnd(10) + 'AR (%)'.padStart(10) + 'R/R'.padStart(10) + 'MDD (%)'.padStart(10));
    console.log('-'.repeat(50));
    for (const [q, m] of Object.entries(quarterly).sort()) {
        console.log(q.padEnd(10) + (m.AR * 100).toFixed(2).padStart(10) + m.RR.toFixed(2).padStart(10) + (m.MDD * 100).toFixed(2).padStart(10));
    }

    console.log('\n' + '='.repeat(70));
    console.log('市場環境別パフォーマンス');
    console.log('='.repeat(70));
    const regime = regimePerformance(results);
    console.log(`強気相場 (${regime.bullDays}日): AR=${(regime.bull.AR * 100).toFixed(2)}%, R/R=${regime.bull.RR.toFixed(2)}`);
    console.log(`弱気相場 (${regime.bearDays}日): AR=${(regime.bear.AR * 100).toFixed(2)}%, R/R=${regime.bear.RR.toFixed(2)}`);

    console.log('\n' + '='.repeat(70));
    console.log('シグナル精度（PCA シグナル vs 翌日 OC リターンの符号）');
    console.log('='.repeat(70));
    const signalAnalysis = analyzeSignals(retUs, retJp, retJpOc, CONFIG, SECTOR_LABELS, CFull);
    console.log(`正解率: ${(signalAnalysis.accuracy * 100).toFixed(1)}%`);
    console.log(`正解: ${signalAnalysis.correct}回，誤り：${signalAnalysis.incorrect}回`);

    const analysisReport = {
        summary: metrics,
        yearly,
        quarterly,
        regime,
        signalAccuracy: signalAnalysis,
        analysisDate: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(outputDir, 'analysis_report.json'), JSON.stringify(analysisReport, null, 2));

    const yearlyCsv =
        'Year,AR (%),RISK (%),R/R,MDD (%),Sharpe\n' +
        Object.entries(yearly)
            .map(([y, m]) => `${y},${(m.AR * 100).toFixed(4)},${(m.RISK * 100).toFixed(4)},${m.RR.toFixed(4)},${(m.MDD * 100).toFixed(4)},${m.Sharpe.toFixed(4)}`)
            .join('\n');
    fs.writeFileSync(path.join(outputDir, 'yearly_performance.csv'), yearlyCsv);

    console.log('\n分析結果を保存しました：results/analysis_report.json');
    console.log('\n' + '='.repeat(70));
    console.log('考察');
    console.log('='.repeat(70));

    const issues = [];
    if (metrics.RR < 0) issues.push('✗ R/R 比が負（戦略が機能していない）');
    else if (metrics.RR < 0.3) issues.push('△ R/R 比が 0.3 未満（改善の余地あり）');
    else issues.push('✓ R/R 比が 0.3 以上（良好）');

    if (metrics.MDD < -0.25) issues.push('✗ 最大ドローダウンが -25% 未満（リスク大きすぎ）');
    else if (metrics.MDD < -0.15) issues.push('△ 最大ドローダウンが -15% 未満（改善の余地あり）');
    else issues.push('✓ 最大ドローダウンが -15% 以内（良好）');

    const yearlyEntries = Object.entries(yearly);

    console.log('\n【戦略評価】');
    issues.forEach(i => console.log(`  ${i}`));

    console.log(`\n【年別推移】`);
    if (yearlyEntries.length > 0) {
        const bestYear = yearlyEntries.reduce((a, b) => (a[1].AR > b[1].AR ? a : b));
        const worstYear = yearlyEntries.reduce((a, b) => (a[1].AR < b[1].AR ? a : b));
        console.log(`  最良年：${bestYear[0]} (AR: ${(bestYear[1].AR * 100).toFixed(2)}%)`);
        console.log(`  最悪年：${worstYear[0]} (AR: ${(worstYear[1].AR * 100).toFixed(2)}%)`);
    } else {
        console.log('  （年別データなし）');
    }

    console.log(`\n【市場環境】`);
    console.log(`  強気相場でのパフォーマンス：${regime.bull.RR > 0 ? '良好' : '不良'}`);
    console.log(`  弱気相場でのパフォーマンス：${regime.bear.RR > 0 ? '良好' : '不良'}`);

    console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
