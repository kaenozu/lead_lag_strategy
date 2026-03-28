/**
 * 詳細パラメータ最適化スクリプト
 * 修正後の戦略で最適なパラメータを探索
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { loadCSV } = require('../lib/data');
const { config: defaultConfig } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio } = require('../lib/portfolio');
const { computePerformanceMetrics } = require('../lib/portfolio');
const { buildReturnMatricesFromOhlcv, computeCFull } = require('../backtest/common');

// 拡張パラメータグリッド
const PARAM_GRID = {
    windowLength: [40, 50, 60, 80],
    lambdaReg: [0.85, 0.9, 0.95, 1.0],
    quantile: [0.3, 0.35, 0.4, 0.45],
    nFactors: [2, 3, 4]
};

const BASE_CONFIG = {
    ...defaultConfig.backtest,
    warmupPeriod: 60,
    transactionCosts: { slippage: 0.001, commission: 0.0005 }
};

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

function loadLocalData(dataDir, tickers) {
    const results = {};
    for (const ticker of tickers) {
        const filePath = path.join(dataDir, `${ticker}.csv`);
        if (fs.existsSync(filePath)) {
            results[ticker] = loadCSV(filePath);
            console.log(`  ${ticker}: ${results[ticker].length} days`);
        } else {
            console.error(`  File not found: ${filePath}`);
            results[ticker] = [];
        }
    }
    return results;
}

function runStrategy(retUs, retJp, retJpOc, cfg, labels, CFull) {
    const nJp = retJp[0].values.length;
    const results = [];
    const signalGen = new LeadLagSignal(cfg);

    for (let i = cfg.warmupPeriod; i < retJpOc.length; i++) {
        const start = i - cfg.windowLength;
        const retUsWin = retUs.slice(start, i).map(r => r.values);
        const retJpWin = retJp.slice(start, i).map(r => r.values);
        const retUsLatest = retUs[i - 1].values; // ルックアヘッドバイアス回避
        
        const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);
        const weights = buildPortfolio(signal, cfg.quantile);
        
        const retNext = retJpOc[i].values;
        let stratRet = 0;
        for (let j = 0; j < nJp; j++) stratRet += weights[j] * retNext[j];
        
        // 取引コスト
        const costs = cfg.transactionCosts;
        if (costs) {
            const grossExposure = weights.reduce((sum, w) => sum + Math.abs(w), 0);
            stratRet -= (costs.slippage + costs.commission) * grossExposure;
        }
        
        results.push({ date: retJpOc[i].date, return: stratRet });
    }

    return results;
}

function computeMetrics(returns) {
    const m = computePerformanceMetrics(returns, 252);
    return {
        AR: m.AR * 100,
        RISK: m.RISK * 100,
        RR: m.RR,
        MDD: m.MDD * 100,
        Total: (m.Cumulative - 1) * 100
    };
}

function optimizeParams(retUs, retJp, retJpOc, labels, CFull) {
    console.log('[3/4] パラメータ最適化中...');
    let bestScore = -Infinity;
    let bestConfig = null;
    let bestMetrics = null;

    const keys = Object.keys(PARAM_GRID);
    const n = keys.length;
    let count = 0;
    const total = Object.values(PARAM_GRID).reduce((a, b) => a * b.length, 1);

    function generateCombinations(idx, current) {
        if (idx === n) {
            count++;
            const cfg = { ...BASE_CONFIG, ...current, warmupPeriod: current.windowLength };
            try {
                const results = runStrategy(retUs, retJp, retJpOc, cfg, labels, CFull);
                const metrics = computeMetrics(results.map(r => r.return));
                const score = metrics.RR * 2 - Math.abs(metrics.MDD) * 0.5; // R/R 重視、MDD 罰則

                if (score > bestScore && metrics.AR > 0) {
                    bestScore = score;
                    bestConfig = { ...cfg };
                    bestMetrics = { ...metrics };
                    console.log(`  [${count}/${total}] 新記録：λ=${cfg.lambdaReg}, window=${cfg.windowLength}, q=${cfg.quantile}, factors=${cfg.nFactors}`);
                    console.log(`           => AR=${metrics.AR.toFixed(2)}%, R/R=${metrics.RR.toFixed(2)}, MDD=${metrics.MDD.toFixed(1)}%`);
                }
            } catch (error) {
                console.warn(`  ⚠️  パラメータ組み合わせでエラー：${JSON.stringify(cfg)} - ${error.message}`);
            }
            return;
        }

        for (const val of PARAM_GRID[keys[idx]]) {
            current[keys[idx]] = val;
            generateCombinations(idx + 1, current);
        }
    }

    generateCombinations(0, {});

    console.log(`\n最適パラメータ:`);
    console.log(`  λ (lambdaReg): ${bestConfig.lambdaReg}`);
    console.log(`  windowLength: ${bestConfig.windowLength}`);
    console.log(`  quantile: ${bestConfig.quantile}`);
    console.log(`  nFactors: ${bestConfig.nFactors}`);
    
    return { config: bestConfig, metrics: bestMetrics };
}

function main() {
    console.log('======================================================================');
    console.log('日米業種リードラグ戦略 - 詳細パラメータ最適化');
    console.log('======================================================================\n');

    const dataDir = path.join(__dirname, '..', 'data');
    console.log('[1/4] ローカルデータ読み込み中...');
    const data = loadLocalData(dataDir, [...US_ETF_TICKERS, ...JP_ETF_TICKERS]);

    console.log('\n[2/4] データ処理中...');
    const usData = {};
    const jpData = {};
    for (const t of US_ETF_TICKERS) usData[t] = data[t];
    for (const t of JP_ETF_TICKERS) jpData[t] = data[t];
    
    const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc } = buildReturnMatricesFromOhlcv(usData, jpData, 'cc');
    console.log(`  取引日数：${returnsJp.length}`);

    // 長期相関行列の計算
    console.log('  長期相関行列計算中...');
    const CFull = computeCFull(returnsUs, returnsJp, 252 * 5); // 5 年データ

    const { config: optimalConfig, metrics } = optimizeParams(returnsUs, returnsJp, returnsJpOc, null, CFull);

    console.log('\n[4/4] 最適パラメータでのパフォーマンス:');
    console.log('----------------------------------------------------------------------');
    console.log(`  年率リターン (AR): ${metrics.AR.toFixed(2)}%`);
    console.log(`  年率リスク (RISK): ${metrics.RISK.toFixed(2)}%`);
    console.log(`  シャープレシオ (R/R): ${metrics.RR.toFixed(2)}`);
    console.log(`  最大ドローダウン (MDD): ${metrics.MDD.toFixed(1)}%`);
    console.log(`  累積リターン: ${metrics.Total.toFixed(2)}%`);
    console.log('----------------------------------------------------------------------\n');

    // 結果保存
    const outputDir = path.join(__dirname, '..', 'results');
    fs.mkdirSync(outputDir, { recursive: true });
    
    fs.writeFileSync(
        path.join(outputDir, 'optimal_parameters_detailed.json'),
        JSON.stringify({
            parameters: {
                windowLength: optimalConfig.windowLength,
                lambdaReg: optimalConfig.lambdaReg,
                quantile: optimalConfig.quantile,
                nFactors: optimalConfig.nFactors
            },
            metrics: metrics
        }, null, 2)
    );
    
    console.log(`結果保存先：${path.join(outputDir, 'optimal_parameters_detailed.json')}`);
}

main();
