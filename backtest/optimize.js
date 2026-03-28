/**
 * backtest/optimize.js
 * パラメータグリッドサーチ（ウォークフォワード検証付き）
 * 目的：過学習を回避しつつ最適パラメータを発見
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');
const {
  buildReturnMatricesFromOhlcv,
  computeCFull
} = require('./common');
const { fetchOhlcvDateRangeForTickers } = require('../lib/data');
const { averageMomentumWindow, weightedReturn } = require('../lib/backtestUtils');

// ============================================================================
// グリッド定義
// ============================================================================

const GRID = {
  lambdaReg: [0, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95],
  nFactors: [1, 2, 3],
  quantile: [0.3, 0.35, 0.4, 0.45],
  windowLength: [40, 60, 80],
  consecutiveLossThreshold: [0, 2, 3],
  consecutiveLossReduction: [0.5, 0.75, 1.0]
};

// ウォークフォワード設定
const WF = {
  trainRatio: 0.7,   // 70% を学習、30% をテスト
};

// ============================================================================
// バックテストエンジン
// ============================================================================

function runSingleBacktest(returnsUs, returnsJp, returnsJpOc, params, CFull) {
  const nJp = returnsJp[0].values.length;
  const strategyReturns = [];
  let prevWeights = null;
  let prevConsecutiveLoss = 0;

  const signalGenerator = new LeadLagSignal({
    windowLength: params.windowLength,
    nFactors: params.nFactors,
    lambdaReg: params.lambdaReg,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  for (let i = params.windowLength; i < returnsJpOc.length; i++) {
    const windowStart = i - params.windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
    const retUsLatest = returnsUs[i - 1].values;

    let positionSize = 1.0;
    if (params.consecutiveLossThreshold > 0 &&
        prevConsecutiveLoss >= params.consecutiveLossThreshold) {
      positionSize = 1.0 - params.consecutiveLossReduction;
    }

    let weights;
    try {
      const signal = signalGenerator.computeSignal(
        retUsWindow, retJpWindow, retUsLatest, SECTOR_LABELS, CFull
      );
      weights = buildPortfolio(signal, params.quantile);
    } catch {
      weights = prevWeights || new Array(nJp).fill(0);
    }

    weights = weights.map(w => w * positionSize);
    const retNext = returnsJpOc[i].values;
    let strategyRet = weightedReturn(weights, retNext);

    if (params.consecutiveLossThreshold > 0) {
      if (strategyRet < 0) prevConsecutiveLoss++;
      else prevConsecutiveLoss = 0;
    }

    prevWeights = weights;
    strategyReturns.push(strategyRet);
  }

  return strategyReturns;
}

// ============================================================================
// グリッドサーチ
// ============================================================================

function generateCombinations(grid) {
  const keys = Object.keys(grid);
  const combos = [{}];
  for (const key of keys) {
    const next = [];
    for (const combo of combos) {
      for (const val of grid[key]) {
        next.push({ ...combo, [key]: val });
      }
    }
    combos.splice(0, combos.length, ...next);
  }
  return combos;
}

function scoreMetrics(metrics) {
  if (!metrics || metrics.RISK <= 0) return -Infinity;
  const sharpe = metrics.RR;
  const mdd = metrics.MDD;
  const mddPenalty = mdd < -0.20 ? -1.0 : (mdd < -0.10 ? -0.3 : 0);
  return sharpe + mddPenalty;
}

// ============================================================================
// メイン
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('パラメータ最適化（グリッドサーチ + ウォークフォワード検証）');
  console.log('='.repeat(70));

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  console.log('\n[1/4] データ取得...');
  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvDateRangeForTickers(US_ETF_TICKERS, config.data.startDate, config.data.endDate, config),
    fetchOhlcvDateRangeForTickers(JP_ETF_TICKERS, config.data.startDate, config.data.endDate, config)
  ]);

  console.log('[2/4] データ処理...');
  const { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
    usRes.byTicker, jpRes.byTicker, config.backtest.jpWindowReturn
  );
  console.log(`  取引日数: ${dates.length}, 期間: ${dates[0]} ~ ${dates[dates.length - 1]}`);

  const CFull = computeCFull(retUs, retJp);

  // 学習/テスト分割
  const splitIdx = Math.floor(dates.length * WF.trainRatio);
  const splitDate = dates[splitIdx];
  console.log(`  学習期間: ${dates[0]} ~ ${splitDate} (${splitIdx}日)`);
  console.log(`  テスト期間: ${dates[splitIdx]} ~ ${dates[dates.length - 1]} (${dates.length - splitIdx}日)`);

  const trainUs = retUs.slice(0, splitIdx);
  const trainJp = retJp.slice(0, splitIdx);
  const trainJpOc = retJpOc.slice(0, splitIdx);
  const testUs = retUs.slice(splitIdx);
  const testJp = retJp.slice(splitIdx);
  const testJpOc = retJpOc.slice(splitIdx);
  const trainCFull = computeCFull(trainUs, trainJp);

  console.log('\n[3/4] グリッドサーチ（学習期間）...');
  const combos = generateCombinations(GRID);
  console.log(`  組み合わせ数: ${combos.length}`);

  const results = [];
  let count = 0;

  for (const params of combos) {
    count++;
    try {
      const returns = runSingleBacktest(trainUs, trainJp, trainJpOc, params, trainCFull);
      const metrics = computePerformanceMetrics(returns);
      const score = scoreMetrics(metrics);
      results.push({ params: { ...params }, trainMetrics: metrics, trainScore: score });
    } catch {
      // skip invalid combinations
    }
    if (count % 200 === 0) process.stdout.write(`  ${count}/${combos.length}\n`);
  }
  console.log(`  完了: ${results.length} 有効組み合わせ`);

  // スコア順ソート → Top 10
  results.sort((a, b) => b.trainScore - a.trainScore);
  const topN = results.slice(0, 10);

  console.log('\n[4/4] ウォークフォワード検証（テスト期間）...');
  console.log('\n' + '='.repeat(100));
  console.log(
    'Rank'.padEnd(5) +
    'λ'.padEnd(6) + 'nF'.padEnd(4) + 'q'.padEnd(6) + 'win'.padEnd(5) +
    'cLossT'.padEnd(7) + 'cLossR'.padEnd(7) +
    '| Train AR%'.padEnd(12) + 'Train RR'.padEnd(10) + 'Train MDD%'.padEnd(12) +
    '| Test AR%'.padEnd(12) + 'Test RR'.padEnd(10) + 'Test MDD%'
  );
  console.log('-'.repeat(100));

  for (let rank = 0; rank < topN.length; rank++) {
    const { params, trainMetrics } = topN[rank];
    const testReturns = runSingleBacktest(testUs, testJp, testJpOc, params, CFull);
    const testMetrics = computePerformanceMetrics(testReturns);
    topN[rank].testMetrics = testMetrics;

    const fmt = (v, pct = true) => (pct ? (v * (pct === true ? 100 : 1)).toFixed(2) : v.toFixed(3));
    console.log(
      `${(rank + 1).toString().padEnd(5)}` +
      `${params.lambdaReg.toString().padEnd(6)}` +
      `${params.nFactors.toString().padEnd(4)}` +
      `${params.quantile.toString().padEnd(6)}` +
      `${params.windowLength.toString().padEnd(5)}` +
      `${params.consecutiveLossThreshold.toString().padEnd(7)}` +
      `${params.consecutiveLossReduction.toString().padEnd(7)}` +
      `| ${fmt(trainMetrics.AR).padStart(10)} ` +
      `${fmt(trainMetrics.RR, false).padStart(8)} ` +
      `${fmt(trainMetrics.MDD).padStart(10)} ` +
      `| ${fmt(testMetrics.AR).padStart(10)} ` +
      `${fmt(testMetrics.RR, false).padStart(8)} ` +
      `${fmt(testMetrics.MDD).padStart(10)}`
    );
  }

  // ベストの詳細表示
  const best = topN[0];
  console.log('\n' + '='.repeat(70));
  console.log('ベストパラメータ（学習期間スコア順位 1 位）');
  console.log('='.repeat(70));
  console.log(`  λ=${best.params.lambdaReg}, nFactors=${best.params.nFactors}, quantile=${best.params.quantile}`);
  console.log(`  windowLength=${best.params.windowLength}`);
  console.log(`  consecutiveLoss: threshold=${best.params.consecutiveLossThreshold}, reduction=${best.params.consecutiveLossReduction}`);
  console.log(`\n  学習: AR=${(best.trainMetrics.AR * 100).toFixed(2)}%, RR=${best.trainMetrics.RR.toFixed(3)}, MDD=${(best.trainMetrics.MDD * 100).toFixed(2)}%`);
  console.log(`  テスト: AR=${(best.testMetrics.AR * 100).toFixed(2)}%, RR=${best.testMetrics.RR.toFixed(3)}, MDD=${(best.testMetrics.MDD * 100).toFixed(2)}%`);

  // 過学習判定
  const trainAR = best.trainMetrics.AR;
  const testAR = best.testMetrics.AR;
  const degradation = trainAR > 0 ? (trainAR - testAR) / trainAR : 0;
  console.log(`\n  AR低下率: ${(degradation * 100).toFixed(1)}% ${degradation > 0.5 ? '⚠ 過学習の可能性' : '✓ 過学習リスク低い'}`);

  // フル期間でも再計算
  const fullReturns = runSingleBacktest(retUs, retJp, retJpOc, best.params, CFull);
  const fullMetrics = computePerformanceMetrics(fullReturns);
  console.log(`  フル期間: AR=${(fullMetrics.AR * 100).toFixed(2)}%, RR=${fullMetrics.RR.toFixed(3)}, MDD=${(fullMetrics.MDD * 100).toFixed(2)}%, 累計=${((fullMetrics.Cumulative - 1) * 100).toFixed(2)}%`);

  // 現在のデフォルトと比較
  const defaultParams = {
    lambdaReg: config.backtest.lambdaReg,
    nFactors: config.backtest.nFactors,
    quantile: config.backtest.quantile,
    windowLength: config.backtest.windowLength,
    consecutiveLossThreshold: config.backtest.consecutiveLoss?.threshold || 0,
    consecutiveLossReduction: config.backtest.consecutiveLoss?.reduction || 0
  };
  const defaultReturns = runSingleBacktest(retUs, retJp, retJpOc, defaultParams, CFull);
  const defaultMetrics = computePerformanceMetrics(defaultReturns);
  console.log(`\n  現在のデフォルト: AR=${(defaultMetrics.AR * 100).toFixed(2)}%, RR=${defaultMetrics.RR.toFixed(3)}, MDD=${(defaultMetrics.MDD * 100).toFixed(2)}%, 累計=${((defaultMetrics.Cumulative - 1) * 100).toFixed(2)}%`);

  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const csvRows = ['rank,lambdaReg,nFactors,quantile,windowLength,cLossT,cLossR,train_AR,train_RR,train_MDD,test_AR,test_RR,test_MDD'];
  for (let i = 0; i < topN.length; i++) {
    const r = topN[i];
    csvRows.push([
      i + 1, r.params.lambdaReg, r.params.nFactors, r.params.quantile, r.params.windowLength,
      r.params.consecutiveLossThreshold, r.params.consecutiveLossReduction,
      (r.trainMetrics.AR * 100).toFixed(4), r.trainMetrics.RR.toFixed(4), (r.trainMetrics.MDD * 100).toFixed(4),
      (r.testMetrics.AR * 100).toFixed(4), r.testMetrics.RR.toFixed(4), (r.testMetrics.MDD * 100).toFixed(4)
    ].join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'optimization_results.csv'), csvRows.join('\n'));
  console.log(`\n結果保存: ${path.join(outputDir, 'optimization_results.csv')}`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
