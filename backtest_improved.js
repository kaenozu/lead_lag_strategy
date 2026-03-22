/**
 * 日米業種リードラグ戦略 - 改良版（高速グリッドサーチ）
 * パラメータ調整・高速化を含む完全版
 */

const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { LeadLagSignal } = require('./lib/pca');
const { buildLeadLagMatrices } = require('./lib/lead_lag_matrices');
const { buildPortfolio, computePerformanceMetrics } = require('./lib/portfolio');
const { correlationMatrixSample } = require('./lib/math');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('./lib/constants');

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
// ポートフォリオ & パフォーマンス
// ============================================================================

function computeMetrics(returns, ann = 252) {
    const m = computePerformanceMetrics(returns);
    m.AR = m.AR * ann / 252;
    return m;
}

// ============================================================================
// データ処理
// ============================================================================

function computeCFull(retUs, retJp) {
    const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
        .map((r, i) => [...r.values, ...retJp[i].values]);
    return correlationMatrixSample(combined);
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
            signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);
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
        
        const signalPca = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);
        
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
    const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS);
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
    const resultsMom = runStrategy(retUs, retJp, retJpOc, { ...optConfig, lambdaReg: 0 }, SECTOR_LABELS, CFull, true);
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
