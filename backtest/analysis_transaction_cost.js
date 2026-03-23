/**
 * 取引コスト感応度分析
 * Transaction Cost Sensitivity Analysis
 */

const fs = require('fs');
const path = require('path');
const { LeadLagSignal } = require('../lib/pca');
const { buildLeadLagMatrices } = require('../lib/lead_lag_matrices');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');

// ============================================================================
// 設定
// ============================================================================

const BASE_CONFIG = {
  windowLength: 60,
  nFactors: 3,
  lambdaReg: 0.9,
  quantile: 0.4,
  warmupPeriod: 60
};

// 取引コスト設定（スリッページ + 手数料）
const TRANSACTION_COSTS = [0, 0.0005, 0.001, 0.0015, 0.002]; // 0%, 0.05%, 0.1%, 0.15%, 0.2%

// ============================================================================
// データ読み込み
// ============================================================================

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
// 戦略実行（取引コスト込み）
// ============================================================================

function runStrategyWithCosts(retUs, retJp, retJpOc, config, labels, CFull, transactionCost) {
  const nJp = retJp[0].values.length;
  const results = [];
  const signalGen = new LeadLagSignal(config);
  let prevWeights = new Array(nJp).fill(0);

  for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
    const start = i - config.windowLength;
    const retUsWin = retUs.slice(start, i).map(r => r.values);
    const retJpWin = retJp.slice(start, i).map(r => r.values);
    const retUsLatest = retUs[i].values;
        
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);
    const weights = buildPortfolio(signal, config.quantile);
        
    // 取引コストの計算（ターンオーバーベース）
    let turnover = 0;
    for (let j = 0; j < nJp; j++) {
      turnover += Math.abs(weights[j] - prevWeights[j]);
    }
    const cost = turnover * transactionCost / 2; // 両側コスト
        
    const retNext = retJpOc[i].values;
    let stratRet = 0;
    for (let j = 0; j < nJp; j++) {
      stratRet += weights[j] * retNext[j];
    }
    stratRet -= cost; // コストを差し引き
        
    results.push({ 
      date: retJpOc[i].date, 
      return: stratRet,
      turnover: turnover,
      cost: cost
    });
        
    prevWeights = weights;
  }

  return results;
}

function runMomStrategyWithCosts(retUs, retJp, retJpOc, config, labels, transactionCost) {
  const nJp = retJp[0].values.length;
  const results = [];
  let prevWeights = new Array(nJp).fill(0);

  for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
    const start = i - config.windowLength;
        
    // モメンタムシグナル（過去 L 日の累積リターン）
    const signal = new Array(nJp).fill(0);
    for (let j = start; j < i; j++) {
      for (let k = 0; k < nJp; k++) {
        signal[k] += retJp[j].values[k];
      }
    }
    for (let k = 0; k < nJp; k++) {
      signal[k] /= config.windowLength;
    }
        
    const weights = buildPortfolio(signal, config.quantile);
        
    // 取引コスト
    let turnover = 0;
    for (let j = 0; j < nJp; j++) {
      turnover += Math.abs(weights[j] - prevWeights[j]);
    }
    const cost = turnover * transactionCost / 2;
        
    const retNext = retJpOc[i].values;
    let stratRet = 0;
    for (let j = 0; j < nJp; j++) {
      stratRet += weights[j] * retNext[j];
    }
    stratRet -= cost;
        
    results.push({ 
      date: retJpOc[i].date, 
      return: stratRet,
      turnover: turnover,
      cost: cost
    });
        
    prevWeights = weights;
  }

  return results;
}

// ============================================================================
// 分析関数
// ============================================================================

function analyzeTransactionCostSensitivity(retUs, retJp, retJpOc, config) {
  const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
    .map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  const results = {};

  for (const cost of TRANSACTION_COSTS) {
    console.log(`  コスト ${cost * 100}% を計算中...`);
        
    // PCA SUB
    const resultsSub = runStrategyWithCosts(retUs, retJp, retJpOc, config, SECTOR_LABELS, CFull, cost);
    const metricsSub = computePerformanceMetrics(resultsSub.map(r => r.return));
        
    // MOM
    const resultsMom = runMomStrategyWithCosts(retUs, retJp, retJpOc, config, SECTOR_LABELS, cost);
    const metricsMom = computePerformanceMetrics(resultsMom.map(r => r.return));
        
    // 平均ターンオーバー
    const avgTurnover = resultsSub.reduce((a, b) => a + b.turnover, 0) / resultsSub.length;
    const avgCost = resultsSub.reduce((a, b) => a + b.cost, 0) / resultsSub.length;
    const totalCost = resultsSub.reduce((a, b) => a + b.cost, 0);
        
    results[cost] = {
      pcaSub: {
        AR: metricsSub.AR * 100,
        RISK: metricsSub.RISK * 100,
        RR: metricsSub.RR,
        MDD: metricsSub.MDD * 100,
        Total: (metricsSub.Cumulative - 1) * 100
      },
      mom: {
        AR: metricsMom.AR * 100,
        RISK: metricsMom.RISK * 100,
        RR: metricsMom.RR,
        MDD: metricsMom.MDD * 100,
        Total: (metricsMom.Cumulative - 1) * 100
      },
      turnover: {
        avgTurnover,
        avgCost,
        totalCost
      }
    };
  }

  return results;
}

function findBreakEvenCost(retUs, retJp, retJpOc, config) {
  const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
    .map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  // 二分探索で損益分岐点を発見
  let low = 0, high = 0.01; // 0% - 1%
  let breakEven = 0;

  for (let iter = 0; iter < 20; iter++) {
    const mid = (low + high) / 2;
    const results = runStrategyWithCosts(retUs, retJp, retJpOc, config, SECTOR_LABELS, CFull, mid);
    const metrics = computePerformanceMetrics(results.map(r => r.return));
        
    if (metrics.AR > 0) {
      low = mid;
      breakEven = mid;
    } else {
      high = mid;
    }
  }

  return breakEven;
}

// ============================================================================
// メイン
// ============================================================================

function main() {
  console.log('='.repeat(70));
  console.log('取引コスト感応度分析');
  console.log('='.repeat(70));

  const dataDir = path.join(__dirname, '..', 'data');
  const outputDir = path.join(__dirname, '..', 'results');
    
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // データ読み込み
  console.log('\n[1/3] データ読み込み中...');
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  const usEmpty = US_ETF_TICKERS.filter(t => usData[t].length === 0);
  const jpEmpty = JP_ETF_TICKERS.filter(t => jpData[t].length === 0);

  if (usEmpty.length > 0 || jpEmpty.length > 0) {
    console.error('エラー：データ不足');
    console.error(`  米国 ETF 不足：${usEmpty.join(', ')}`);
    console.error(`  日本 ETF 不足：${jpEmpty.join(', ')}`);
    console.error('  最初に `npm run backtest` を実行してください');
    return;
  }

  // データ処理
  console.log('\n[2/3] データ処理中...');
  const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(
    usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS
  );
  console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

  if (dates.length < 100) {
    console.error('エラー：データ不足');
    return;
  }

  // 分析実行
  console.log('\n[3/3] 取引コスト感応度分析を実行中...');
  const sensitivity = analyzeTransactionCostSensitivity(retUs, retJp, retJpOc, BASE_CONFIG);
    
  // 損益分岐点
  console.log('\n  損益分岐点を計算中...');
  const breakEvenCost = findBreakEvenCost(retUs, retJp, retJpOc, BASE_CONFIG);

  // 結果表示
  console.log('\n' + '='.repeat(70));
  console.log('取引コスト感応度結果');
  console.log('='.repeat(70));
    
  console.log('\n【PCA SUB 戦略】');
  console.log('Cost'.padStart(8) + 'AR (%)'.padStart(10) + 'RISK (%)'.padStart(10) + 
                'R/R'.padStart(8) + 'MDD (%)'.padStart(10) + 'Total (%)'.padStart(12));
  console.log('-'.repeat(60));
    
  for (const [cost, data] of Object.entries(sensitivity)) {
    const c = (parseFloat(cost) * 100).toFixed(2);
    const m = data.pcaSub;
    console.log(
      `${c}%`.padStart(8) +
            m.AR.toFixed(2).padStart(10) +
            m.RISK.toFixed(2).padStart(10) +
            m.RR.toFixed(2).padStart(8) +
            m.MDD.toFixed(2).padStart(10) +
            m.Total.toFixed(2).padStart(12)
    );
  }

  console.log('\n【MOM 戦略】');
  console.log('Cost'.padStart(8) + 'AR (%)'.padStart(10) + 'RISK (%)'.padStart(10) + 
                'R/R'.padStart(8) + 'MDD (%)'.padStart(10) + 'Total (%)'.padStart(12));
  console.log('-'.repeat(60));
    
  for (const [cost, data] of Object.entries(sensitivity)) {
    const c = (parseFloat(cost) * 100).toFixed(2);
    const m = data.mom;
    console.log(
      `${c}%`.padStart(8) +
            m.AR.toFixed(2).padStart(10) +
            m.RISK.toFixed(2).padStart(10) +
            m.RR.toFixed(2).padStart(8) +
            m.MDD.toFixed(2).padStart(10) +
            m.Total.toFixed(2).padStart(12)
    );
  }

  console.log('\n【損益分岐点】');
  console.log(`  PCA SUB: ${(breakEvenCost * 100).toFixed(3)}% (片道 ${(breakEvenCost * 100 / 2).toFixed(3)}%)`);
    
  if (breakEvenCost > 0.0015) {
    console.log('  ✓ 実用的なコスト耐性があります');
  } else if (breakEvenCost > 0.0005) {
    console.log('  △ 標準的なコスト環境で採算が取れます');
  } else {
    console.log('  ✗ コスト耐性が低いです');
  }

  console.log('\n【ターンオーバー統計】');
  console.log('Cost'.padStart(8) + 'Avg Turnover'.padStart(14) + 'Avg Cost (%)'.padStart(12) + 'Total Cost (%)'.padStart(14));
  console.log('-'.repeat(50));
    
  for (const [cost, data] of Object.entries(sensitivity)) {
    const c = (parseFloat(cost) * 100).toFixed(2);
    const t = data.turnover;
    console.log(
      `${c}%`.padStart(8) +
            t.avgTurnover.toFixed(4).padStart(14) +
            (t.avgCost * 100).toFixed(4).padStart(12) +
            (t.totalCost * 100).toFixed(4).padStart(14)
    );
  }

  // 結果保存
  const summaryCSV = 'Strategy,Cost,AR,RISK,RR,MDD,Total\n' +
        Object.entries(sensitivity).flatMap(([cost, data]) => [
          `PCA SUB,${cost},${data.pcaSub.AR.toFixed(4)},${data.pcaSub.RISK.toFixed(4)},${data.pcaSub.RR.toFixed(4)},${data.pcaSub.MDD.toFixed(4)},${data.pcaSub.Total.toFixed(4)}`,
          `MOM,${cost},${data.mom.AR.toFixed(4)},${data.mom.RISK.toFixed(4)},${data.mom.RR.toFixed(4)},${data.mom.MDD.toFixed(4)},${data.mom.Total.toFixed(4)}`
        ]).join('\n');
  fs.writeFileSync(path.join(outputDir, 'transaction_cost_sensitivity.csv'), summaryCSV);

  const breakEvenJSON = JSON.stringify({
    breakEvenCost,
    breakEvenCostPercent: breakEvenCost * 100,
    analysisDate: new Date().toISOString().split('T')[0],
    parameters: BASE_CONFIG
  }, null, 2);
  fs.writeFileSync(path.join(outputDir, 'break_even_cost.json'), breakEvenJSON);

  console.log('\n' + '='.repeat(70));
  console.log('結果保存先:');
  console.log(`  - ${path.join(outputDir, 'transaction_cost_sensitivity.csv')}`);
  console.log(`  - ${path.join(outputDir, 'break_even_cost.json')}`);
  console.log('='.repeat(70));

  // 考察
  console.log('\n【考察】');
  const zeroCostAR = sensitivity[0].pcaSub.AR;
  const point15CostAR = sensitivity[0.0015]?.pcaSub.AR || 0;
  const degradation = zeroCostAR - point15CostAR;
    
  console.log(`・0% コスト時 AR: ${zeroCostAR.toFixed(2)}%`);
  console.log(`・0.15% コスト時 AR: ${point15CostAR.toFixed(2)}%`);
  console.log(`・パフォーマンス劣化：${degradation.toFixed(2)}%`);
    
  if (degradation < zeroCostAR * 0.3) {
    console.log('✓ コストの影響は限定的です');
  } else {
    console.log('✗ コストの影響が大きいです');
  }
}

if (require.main === module) {
  const { createLogger } = require('../lib/logger');
  const logger = createLogger('TransactionCostAnalysis');

  main().catch(error => {
    logger.error('Analysis failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { analyzeTransactionCostSensitivity, findBreakEvenCost };
