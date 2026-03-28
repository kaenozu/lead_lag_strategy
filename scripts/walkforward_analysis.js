/**
 * ウォークフォワード分析
 * 過去 1 年分のデータを 3 ヶ月ごとに区切ってパラメータの安定性を検証
 * 
 * Usage: node scripts/walkforward_analysis.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { createLogger } = require('../lib/logger');
const { computePerformanceMetrics } = require('../lib/portfolio');
const { BACKTEST_CONFIG } = require('./backtest_with_market_regime');

const logger = createLogger('WalkforwardAnalysis');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;

/**
 * ウォークフォワード設定
 */
const WF_CONFIG = {
  trainDays: 120,        // 訓練期間（約 6 ヶ月）
  testDays: 20,          // テスト期間（約 1 ヶ月）
  stepDays: 20,          // ステップ幅（約 1 ヶ月）
  totalPeriods: 6,       // 期間数

  // 実運用中の現行パラメータで再実行する
  useCurrentParams: true,
  currentParams: {
    lambdaReg: BACKTEST_CONFIG.lambdaReg,
    nFactors: BACKTEST_CONFIG.nFactors,
    quantile: BACKTEST_CONFIG.quantile
  },

  // 最適化時の複合目的関数（Sharpe + Return - Drawdown 罰則）
  objectiveWeights: {
    sharpe: 1.0,
    totalReturn: 8.0,
    mddPenalty: 6.0
  },
  
  // パラメータグリッド（簡易版）
  lambdaReg: [0.5, 0.7, 0.9],
  nFactors: [1, 2, 3],
  quantile: [0.4, 0.5, 0.6]
};

function calculateCompositeScore(result) {
  const w = WF_CONFIG.objectiveWeights;
  return (
    w.sharpe * (result.sharpeRatio || 0) +
    w.totalReturn * (result.totalReturn || 0) -
    w.mddPenalty * Math.abs(result.maxDrawdown || 0)
  );
}

/**
 * バックテスト実行（単一パラメータ）
 */
function runBacktest(returnsUs, returnsJpOc, params, sectorLabels, CFull, startDate, endDate) {
  const nJp = returnsJpOc[0].values.length;
  const strategyReturns = [];
  let prevWeights = null;

  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg,
    nFactors: params.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const windowLength = config.backtest.windowLength;
  const warmupPeriod = windowLength;

  for (let i = Math.max(warmupPeriod, startDate); i < endDate && i < returnsJpOc.length; i++) {
    const windowStart = i - windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJpOc.slice(windowStart, i).map(r => r.values);
    const retUsLatest = returnsUs[i - 1].values;

    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      sectorLabels,
      CFull
    );

    // ポートフォリオ構築
    const q = Math.max(1, Math.floor(nJp * params.quantile));
    const ranked = signal.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);

    const longIndices = ranked.slice(-q).map(x => x.idx);
    const shortIndices = ranked.slice(0, q).map(x => x.idx);

    const weights = new Array(nJp).fill(0);
    const w = 1.0 / q;
    for (const idx of longIndices) weights[idx] = w;
    for (const idx of shortIndices) weights[idx] = -w;

    // シグナル平滑化
    const smoothingAlpha = 0.3;
    if (prevWeights) {
      for (let j = 0; j < weights.length; j++) {
        weights[j] = smoothingAlpha * weights[j] + (1 - smoothingAlpha) * prevWeights[j];
      }
    }

    // 損益計算
    const retOc = returnsJpOc[i].values;
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      if (weights[j] !== 0) {
        portfolioReturn += weights[j] * retOc[j];
      }
    }

    // 取引コスト
    const turnover = weights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
    const cost = turnover * (TRANSACTION_COST_RATE + SLIPPAGE_RATE);
    const netReturn = portfolioReturn - cost;

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: netReturn
    });
  }

  if (strategyReturns.length === 0) {
    return {
      params,
      totalReturn: 0,
      sharpeRatio: 0,
      winRate: 0,
      maxDrawdown: 0,
      returns: []
    };
  }

  const returns = strategyReturns.map(r => r.return);
  const metrics = computePerformanceMetrics(returns);

  return {
    params,
    totalReturn: metrics.Cumulative - 1,
    sharpeRatio: metrics.RR,
    winRate: strategyReturns.filter(r => r.return > 0).length / strategyReturns.length,
    maxDrawdown: metrics.MDD,
    returns
  };
}

/**
 * グリッドサーチ（期間内最適化）
 */
function gridSearch(returnsUs, returnsJpOc, sectorLabels, CFull, startDate, endDate) {
  let bestResult = null;
  let bestScore = -Infinity;

  for (const lambdaReg of WF_CONFIG.lambdaReg) {
    for (const nFactors of WF_CONFIG.nFactors) {
      for (const quantile of WF_CONFIG.quantile) {
        const params = { lambdaReg, nFactors, quantile };
        const result = runBacktest(returnsUs, returnsJpOc, params, sectorLabels, CFull, startDate, endDate);
        result.objectiveScore = calculateCompositeScore(result);

        if (result.objectiveScore > bestScore) {
          bestScore = result.objectiveScore;
          bestResult = result;
        }
      }
    }
  }

  return bestResult;
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🔍 ウォークフォワード分析');
  console.log('='.repeat(80));

  // データ取得（過去 1 年分）
  const winDays = 300;
  console.log('\n📡 市場データ取得中...');

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);

  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;

  const { retUs, retJp, retJpOc } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  console.log(`📊 取得完了：${retUs.length}営業日分`);

  // 相関行列計算（全期間固定）
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  // ウォークフォワード分析
  console.log('\n📊 ウォークフォワード分析開始...');
  console.log(`訓練期間：${WF_CONFIG.trainDays}日、テスト期間：${WF_CONFIG.testDays}日、ステップ：${WF_CONFIG.stepDays}日`);

  const periods = [];
  const allOptimalParams = [];

  for (let i = 0; i < WF_CONFIG.totalPeriods; i++) {
    const trainStart = i * WF_CONFIG.stepDays;
    const trainEnd = trainStart + WF_CONFIG.trainDays;
    const testStart = trainEnd;
    const testEnd = testStart + WF_CONFIG.testDays;

    if (testEnd > retUs.length - 10 || periods.length >= WF_CONFIG.totalPeriods) {
      console.log(`期間 ${i + 1}: データ不足のためスキップ`);
      break;
    }

    const period = {
      period: i + 1,
      trainStart: retUs[trainStart].date,
      trainEnd: retUs[trainEnd - 1].date,
      testStart: retUs[testStart].date,
      testEnd: Math.min(testEnd, retUs.length - 1) < retUs.length ? retUs[Math.min(testEnd, retUs.length - 1)].date : 'N/A'
    };

    console.log(`\n--- 期間 ${period.period}: ${period.trainStart} 〜 ${period.testEnd} ---`);
    console.log(`訓練：${period.trainStart} 〜 ${period.trainEnd}`);
    console.log(`テスト：${period.testStart} 〜 ${period.testEnd}`);

    // 訓練期間でパラメータ最適化（または現行パラメータ固定）
    let trainResult;
    if (WF_CONFIG.useCurrentParams) {
      console.log('現行パラメータで訓練期間を評価中...');
      trainResult = runBacktest(
        retUs,
        retJpOc,
        WF_CONFIG.currentParams,
        config.sectorLabels,
        CFull,
        trainStart,
        trainEnd
      );
      trainResult.objectiveScore = calculateCompositeScore(trainResult);
    } else {
      console.log('訓練期間でパラメータ最適化中（複合目的関数）...');
      trainResult = gridSearch(retUs, retJpOc, config.sectorLabels, CFull, trainStart, trainEnd);
    }

    if (!trainResult) {
      console.log('最適化失敗、スキップ');
      continue;
    }

    console.log(`採用パラメータ：lambdaReg=${trainResult.params.lambdaReg}, nFactors=${trainResult.params.nFactors}, quantile=${trainResult.params.quantile}`);
    console.log(`訓練期間シャープレシオ：${trainResult.sharpeRatio.toFixed(2)}`);
    console.log(`訓練期間複合スコア：${trainResult.objectiveScore.toFixed(3)}`);

    // テスト期間で検証（最適パラメータ固定）
    console.log('テスト期間で検証中...');
    const testResult = runBacktest(
      retUs,
      retJpOc,
      trainResult.params,
      config.sectorLabels,
      CFull,
      testStart,
      testEnd
    );

    console.log(`テスト期間シャープレシオ：${testResult.sharpeRatio.toFixed(2)}`);
    console.log(`テスト期間勝率：${(testResult.winRate * 100).toFixed(1)}%`);
    console.log(`テスト期間リターン：${(testResult.totalReturn * 100).toFixed(2)}%`);

    period.optimalParams = trainResult.params;
    period.trainMetrics = {
      sharpeRatio: trainResult.sharpeRatio,
      totalReturn: trainResult.totalReturn,
      winRate: trainResult.winRate,
      objectiveScore: trainResult.objectiveScore
    };
    period.testMetrics = {
      sharpeRatio: testResult.sharpeRatio,
      totalReturn: testResult.totalReturn,
      winRate: testResult.winRate,
      maxDrawdown: testResult.maxDrawdown
    };
    period.stability = trainResult.sharpeRatio - testResult.sharpeRatio; // 安定性（小さいほど良い）

    periods.push(period);
    allOptimalParams.push(trainResult.params);
  }

  // 結果集計
  console.log('\n' + '='.repeat(80));
  console.log('📊 ウォークフォワード分析結果');
  console.log('='.repeat(80));

  console.log('\n期間別パフォーマンス:');
  console.log('Period  訓練 SR  テスト SR  差分    勝率 (%)  リターン (%)  最適パラメータ');
  console.log('-'.repeat(80));

  let totalTestReturn = 0;
  let totalTestSharpe = 0;
  let totalTestWinRate = 0;
  const paramStability = { lambdaReg: {}, nFactors: {}, quantile: {} };

  periods.forEach(p => {
    const diff = p.trainMetrics.sharpeRatio - p.testMetrics.sharpeRatio;
    const diffStr = diff >= 0 ? `-${diff.toFixed(2)}` : `+${Math.abs(diff).toFixed(2)}`;
    
    totalTestReturn += p.testMetrics.totalReturn;
    totalTestSharpe += p.testMetrics.sharpeRatio;
    totalTestWinRate += p.testMetrics.winRate;

    // パラメータ出現回数
    const lr = p.optimalParams.lambdaReg.toFixed(1);
    const nf = p.optimalParams.nFactors;
    const q = p.optimalParams.quantile.toFixed(1);
    
    paramStability.lambdaReg[lr] = (paramStability.lambdaReg[lr] || 0) + 1;
    paramStability.nFactors[nf] = (paramStability.nFactors[nf] || 0) + 1;
    paramStability.quantile[q] = (paramStability.quantile[q] || 0) + 1;

    console.log(
      `${String(p.period).padStart(6)}  ${p.trainMetrics.sharpeRatio.toFixed(2).padStart(8)}  ` +
      `${p.testMetrics.sharpeRatio.toFixed(2).padStart(8)}  ${diffStr.padStart(6)}  ` +
      `${(p.testMetrics.winRate * 100).toFixed(1).padStart(8)}  ` +
      `${(p.testMetrics.totalReturn * 100).toFixed(2).padStart(11)}  ` +
      `λ=${lr}, k=${nf}, q=${q}`
    );
  });

  // 平均パフォーマンス
  const avgTestSharpe = totalTestSharpe / periods.length;
  const avgTestWinRate = totalTestWinRate / periods.length;
  const avgTotalReturn = totalTestReturn / periods.length;

  console.log('\n' + '='.repeat(80));
  console.log('📊 平均パフォーマンス（テスト期間）');
  console.log('='.repeat(80));
  console.log(`平均シャープレシオ：${avgTestSharpe.toFixed(2)}`);
  console.log(`平均勝率：${(avgTestWinRate * 100).toFixed(1)}%`);
  console.log(`平均総リターン：${(avgTotalReturn * 100).toFixed(2)}%`);
  console.log(`期間数：${periods.length}`);

  // パラメータ安定性
  console.log('\n' + '='.repeat(80));
  console.log('📊 パラメータ安定性');
  console.log('='.repeat(80));

  console.log('\nlambdaReg（正則化強度）:');
  const lrSorted = Object.entries(paramStability.lambdaReg || {}).sort((a, b) => b[1] - a[1]);
  lrSorted.forEach(([param, count]) => {
    const pct = periods.length > 0 ? (count / periods.length * 100).toFixed(0) : 0;
    console.log(`  ${param}: ${count}回 (${pct}%)`);
  });

  console.log('\nnFactors（因子数）:');
  const nfSorted = Object.entries(paramStability.nFactors || {}).sort((a, b) => b[1] - a[1]);
  nfSorted.forEach(([param, count]) => {
    const pct = periods.length > 0 ? (count / periods.length * 100).toFixed(0) : 0;
    console.log(`  ${param}: ${count}回 (${pct}%)`);
  });

  console.log('\nquantile（分位点）:');
  const qSorted = Object.entries(paramStability.quantile || {}).sort((a, b) => b[1] - a[1]);
  qSorted.forEach(([param, count]) => {
    const pct = periods.length > 0 ? (count / periods.length * 100).toFixed(0) : 0;
    console.log(`  ${param}: ${count}回 (${pct}%)`);
  });

  // 推奨パラメータ（最頻値）
  const recommendedParams = {
    lambdaReg: lrSorted.length > 0 ? lrSorted[0][0] : '0.7',
    nFactors: nfSorted.length > 0 ? parseInt(nfSorted[0][0]) : 1,
    quantile: qSorted.length > 0 ? parseFloat(qSorted[0][0]) : 0.6
  };

  console.log('\n' + '='.repeat(80));
  console.log('💡 推奨パラメータ（最頻値）');
  console.log('='.repeat(80));
  console.log(`lambdaReg: ${recommendedParams.lambdaReg}`);
  console.log(`nFactors: ${recommendedParams.nFactors}`);
  console.log(`quantile: ${recommendedParams.quantile}`);

  // 過学習チェック
  console.log('\n' + '='.repeat(80));
  console.log('🔍 過学習チェック');
  console.log('='.repeat(80));

  const avgDiff = periods.reduce((sum, p) => sum + (p.trainMetrics.sharpeRatio - p.testMetrics.sharpeRatio), 0) / periods.length;
  const avgReturnDiff = periods.reduce((sum, p) => sum + (p.trainMetrics.totalReturn - p.testMetrics.totalReturn), 0) / periods.length;
  const chosenParamKeys = periods.map(p => `${p.optimalParams.lambdaReg}-${p.optimalParams.nFactors}-${p.optimalParams.quantile}`);
  const uniqueParamCount = new Set(chosenParamKeys).size;
  const paramSwitchRatio = periods.length > 1 ? (uniqueParamCount - 1) / (periods.length - 1) : 0;
  const risk = (avgDiff > 1.5 || avgReturnDiff > 0.02)
    ? 'high'
    : (avgDiff > 0.8 || avgReturnDiff > 0.01 || paramSwitchRatio > 0.6)
      ? 'medium'
      : 'low';
  
  if (risk === 'high') {
    console.log('⚠️ 過学習のリスク：高');
    console.log(`   Sharpe 差分平均：${avgDiff.toFixed(2)}`);
    console.log(`   Return 差分平均：${(avgReturnDiff * 100).toFixed(2)}%`);
    console.log('   目的関数と制約の再調整を推奨します');
  } else if (risk === 'medium') {
    console.log('⚠️ 過学習のリスク：中');
    console.log(`   Sharpe 差分平均：${avgDiff.toFixed(2)}`);
    console.log(`   Return 差分平均：${(avgReturnDiff * 100).toFixed(2)}%`);
    console.log('   追加のロール期間評価を推奨します');
  } else {
    console.log('✅ 過学習のリスク：低');
    console.log(`   Sharpe 差分平均：${avgDiff.toFixed(2)}`);
    console.log(`   Return 差分平均：${(avgReturnDiff * 100).toFixed(2)}%`);
    console.log('   パラメータは安定しています');
  }

  // 結論
  console.log('\n' + '='.repeat(80));
  console.log('💡 結論');
  console.log('='.repeat(80));

  if (avgTestSharpe > 0) {
    console.log('✅ テスト期間でプラスのシャープレシオを確認しました');
    console.log(`   平均シャープレシオ：${avgTestSharpe.toFixed(2)}`);
    console.log('   推奨パラメータでの運用を検討してください');
  } else {
    console.log('⚠️ テスト期間でマイナスのシャープレシオ');
    console.log('   戦略の根本的な見直しが必要です');
  }

  // JSON 出力
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    analysisDate: new Date().toISOString(),
    config: WF_CONFIG,
    periods,
    summary: {
      avgTestSharpe,
      avgTestWinRate,
      avgTotalReturn,
      periodCount: periods.length
    },
    paramStability,
    recommendedParams,
    overfittingCheck: {
      avgDiff,
      avgReturnDiff,
      paramSwitchRatio,
      risk
    }
  };

  const outputPath = path.join(outputDir, `walkforward_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 結果を保存しました：${outputPath}`);

  logger.info('Walkforward analysis completed', {
    avgTestSharpe,
    avgTestWinRate,
    recommendedParams
  });
}

main().catch(error => {
  logger.error('Walkforward analysis failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
