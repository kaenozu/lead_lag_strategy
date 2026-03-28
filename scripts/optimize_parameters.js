/**
 * パラメータ最適化グリッドサーチ
 * 過去 1 ヶ月データで最適パラメータを探索
 * 
 * Usage: node scripts/optimize_parameters.js
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
const {
  computePerformanceMetrics
} = require('../lib/portfolio');

const logger = createLogger('ParameterOptimizer');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;

/**
 * グリッドサーチパラメータ
 */
const GRID = {
  lambdaReg: [0.3, 0.5, 0.7, 0.9],
  nFactors: [1, 2, 3],
  quantile: [0.2, 0.3, 0.4, 0.5],
  shortRatio: [0.0, 0.5],
  dailyLossStop: [0.0, 0.01, 0.02],
  useEwma: [false, true],           // EWMA相関行列使用
  ewmaHalflife: [20, 30]            // EWMA半減期（useEwma=trueのみ有効）
};

const OBJECTIVE_WEIGHTS = {
  sharpe: 1.0,
  totalReturn: 8.0,
  mddPenalty: 6.0
};

// Top N results to display
const TOP_N_RESULTS = 10;

function calculateCompositeScore(result) {
  return (
    OBJECTIVE_WEIGHTS.sharpe * (result.sharpeRatio || 0) +
    OBJECTIVE_WEIGHTS.totalReturn * (result.totalReturn || 0) -
    OBJECTIVE_WEIGHTS.mddPenalty * Math.abs(result.maxDrawdown || 0)
  );
}

/**
 * バックテスト実行（単一パラメータセット）
 */
function runBacktestWithParams(
  returnsUs,
  returnsJp,
  returnsJpOc,
  params,
  sectorLabels,
  CFull
) {
  const strategyReturns = [];
  const dates = [];
  let prevWeights = null;

  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg,
    nFactors: params.nFactors,
    useEwma: params.useEwma || false,
    ewmaHalflife: params.ewmaHalflife || 30,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const windowLength = config.backtest.windowLength;
  const warmupPeriod = windowLength;

  for (let i = warmupPeriod; i < returnsJpOc.length; i++) {
    const windowStart = i - windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJpOc.slice(windowStart, i).map(r => r.values);
    const retUsLatest = returnsUs[i - 1].values;

    // シグナル計算
    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      sectorLabels,
      CFull
    );

    // ポートフォリオ構築（ショート比率調整付き）
    const weights = buildPortfolioWithShortRatio(signal, params.quantile, params.shortRatio);

    // シグナル平滑化（簡易版）
    const smoothingAlpha = 0.3;
    if (prevWeights) {
      for (let j = 0; j < weights.length; j++) {
        weights[j] = smoothingAlpha * weights[j] + (1 - smoothingAlpha) * prevWeights[j];
      }
    }

    // 損益計算（OC リターン使用）
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
    let netReturn = portfolioReturn - cost;

    // 日次損失ストップ
    if (params.dailyLossStop > 0 && netReturn < -params.dailyLossStop) {
      netReturn = -params.dailyLossStop;
    }

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: netReturn
    });
    dates.push(returnsJpOc[i].date);
  }

  const metrics = computePerformanceMetrics(strategyReturns.map(r => r.return));

  return {
    params,
    metrics,
    totalReturn: metrics.Cumulative - 1 || 0,
    sharpeRatio: metrics.RR || 0,
    maxDrawdown: metrics.MDD || 0,
    winRate: strategyReturns.filter(r => r.return > 0).length / strategyReturns.length || 0,
    objectiveScore: 0
  };
}

/**
 * ショート比率調整付きポートフォリオ構築
 */
function buildPortfolioWithShortRatio(signal, quantile, shortRatio = 1.0) {
  const n = signal.length;
  const q = Math.max(1, Math.floor(n * quantile));

  // シグナルでソート
  const ranked = signal.map((val, idx) => ({ val, idx }))
    .sort((a, b) => a.val - b.val);

  const longIndices = ranked.slice(-q).map(x => x.idx);
  const shortIndices = ranked.slice(0, q).map(x => x.idx);

  const weights = new Array(n).fill(0);
  const longWeight = 1.0 / q;
  const shortWeight = -(1.0 / q) * shortRatio;

  for (const idx of longIndices) {
    weights[idx] = longWeight;
  }
  for (const idx of shortIndices) {
    weights[idx] = shortWeight;
  }

  return weights;
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🔍 パラメータ最適化グリッドサーチ');
  console.log('='.repeat(80));

  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  console.log(`\n📅 最適化期間：${oneMonthAgo.toISOString().split('T')[0]} ~ ${today.toISOString().split('T')[0]}`);

  // データ取得（十分なサンプルを確保するため500日分取得）
  const winDays = 500;
  console.log(`\n📡 市場データ取得中（${winDays}日分）...`);

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

  // 相関行列計算
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  // グリッドサーチ
  console.log('\n🔍 グリッドサーチ開始...');
  // useEwma=false時はewmaHalflifeは1種のみ有効なので組み合わせ数を正確に計算
  const totalIterations = GRID.lambdaReg.length * GRID.nFactors.length * GRID.quantile.length *
    GRID.shortRatio.length * GRID.dailyLossStop.length *
    (GRID.useEwma.filter(v => !v).length + GRID.useEwma.filter(v => v).length * GRID.ewmaHalflife.length);
  console.log(`パラメータ組み合わせ数：${totalIterations}`);

  const results = [];
  let iteration = 0;

  for (const lambdaReg of GRID.lambdaReg) {
    for (const nFactors of GRID.nFactors) {
      for (const quantile of GRID.quantile) {
        for (const shortRatio of GRID.shortRatio) {
          for (const dailyLossStop of GRID.dailyLossStop) {
            for (const useEwma of GRID.useEwma) {
              const halflifeValues = useEwma ? GRID.ewmaHalflife : [30];
              for (const ewmaHalflife of halflifeValues) {
                iteration++;

                const params = {
                  lambdaReg,
                  nFactors,
                  quantile,
                  shortRatio,
                  dailyLossStop,
                  useEwma,
                  ewmaHalflife
                };

                try {
                  const result = runBacktestWithParams(
                    retUs,
                    retJp,
                    retJpOc,
                    params,
                    config.sectorLabels,
                    CFull
                  );

                  result.objectiveScore = calculateCompositeScore(result);

                  results.push(result);

                  // 進捗表示（10% ごと）
                  if (iteration % Math.ceil(totalIterations / 10) === 0) {
                    const progress = (iteration / totalIterations * 100).toFixed(0);
                    console.log(`  進捗：${progress}% (${iteration}/${totalIterations})`);
                  }
                } catch (error) {
                  logger.warn(`バックテスト失敗：${JSON.stringify(params)}`, { error: error.message });
                  console.warn(`  ⚠️  パラメータ組み合わせでエラー：${JSON.stringify(params)} - ${error.message}`);
                }
              }
            }
          }
        }
      }
    }
  }

  // 結果ソート（複合目的関数基準）
  results.sort((a, b) => b.objectiveScore - a.objectiveScore);

  console.log('\n' + '='.repeat(80));
  console.log(`📊 最適パラメータ TOP${TOP_N_RESULTS}（複合スコア順）`);
  console.log('='.repeat(80));

  console.log('\nRank  λ      nFact  Quant  Short  Stop   利回り (%)  SR     勝率 (%)  最大 DD (%)  Score');
  console.log('-'.repeat(80));

  if (results.length === 0) {
    console.log('有効な結果がありませんでした。パラメータ範囲を見直してください。');
    return;
  }

  results.slice(0, TOP_N_RESULTS).forEach((r, i) => {
    const totalReturn = r.totalReturn || 0;
    const sharpeRatio = r.sharpeRatio || 0;
    const winRate = r.winRate || 0;
    const maxDrawdown = r.maxDrawdown || 0;
    const objectiveScore = r.objectiveScore || 0;
    
    console.log(
      `${String(i + 1).padStart(4)}  ${r.params.lambdaReg.toFixed(1).padStart(4)}  ` +
      `${String(r.params.nFactors).padStart(5)}  ${r.params.quantile.toFixed(1).padStart(5)}  ` +
      `${r.params.shortRatio.toFixed(1).padStart(5)}  ${r.params.dailyLossStop.toFixed(2).padStart(4)}  ` +
      `${(totalReturn * 100).toFixed(1).padStart(8)}  ` +
      `${sharpeRatio.toFixed(2).padStart(6)}  ` +
      `${(winRate * 100).toFixed(1).padStart(8)}  ` +
      `${(maxDrawdown * 100).toFixed(1).padStart(9)}  ` +
      `${objectiveScore.toFixed(3).padStart(6)}`
    );
  });

  // 最適パラメータ詳細
  const best = results[0];
  console.log('\n' + '='.repeat(80));
  console.log('🏆 最適パラメータ詳細');
  console.log('='.repeat(80));

  console.log('\nパラメータ:');
  console.log(`  lambdaReg:     ${best.params.lambdaReg.toFixed(1)}`);
  console.log(`  nFactors:      ${best.params.nFactors}`);
  console.log(`  quantile:      ${best.params.quantile.toFixed(1)}`);
  console.log(`  shortRatio:    ${best.params.shortRatio.toFixed(1)}`);
  console.log(`  dailyLossStop: ${(best.params.dailyLossStop * 100).toFixed(1)}%`);
  console.log(`  useEwma:       ${best.params.useEwma}`);
  if (best.params.useEwma) {
    console.log(`  ewmaHalflife:  ${best.params.ewmaHalflife}日`);
  }

  console.log('\nパフォーマンス:');
  console.log(`  総利回り：      ${(best.totalReturn * 100).toFixed(2)}%`);
  console.log(`  シャープレシオ： ${best.sharpeRatio.toFixed(2)}`);
  console.log(`  勝率：          ${(best.winRate * 100).toFixed(1)}%`);
  console.log(`  最大ドローダウン： ${(best.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  年率リターン：   ${(best.metrics.AR * 100).toFixed(2)}%`);
  console.log(`  年率ボラティリティ： ${(best.metrics.RISK * 100).toFixed(2)}%`);
  console.log(`  複合スコア：     ${best.objectiveScore.toFixed(3)}`);

  // パラメータ感度分析
  console.log('\n' + '='.repeat(80));
  console.log('📊 パラメータ感度分析');
  console.log('='.repeat(80));

  // lambdaReg 別平均複合スコア
  const lambdaRegStats = {};
  GRID.lambdaReg.forEach(lambda => {
    const filtered = results.filter(r => r.params.lambdaReg === lambda);
    const avgScore = filtered.reduce((sum, r) => sum + r.objectiveScore, 0) / filtered.length;
    lambdaRegStats[lambda.toFixed(1)] = avgScore;
  });

  console.log('\nlambdaReg（正則化強度）別平均複合スコア:');
  Object.entries(lambdaRegStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([lambda, score]) => {
      const bar = '█'.repeat(Math.max(1, Math.floor((score + 10) * 3)));
      console.log(`  ${lambda}: ${score.toFixed(3)} ${bar}`);
    });

  // shortRatio 別平均複合スコア
  const shortRatioStats = {};
  GRID.shortRatio.forEach(ratio => {
    const filtered = results.filter(r => r.params.shortRatio === ratio);
    const avgScore = filtered.reduce((sum, r) => sum + r.objectiveScore, 0) / filtered.length;
    shortRatioStats[ratio.toFixed(1)] = avgScore;
  });

  console.log('\nshortRatio（ショート比率）別平均複合スコア:');
  Object.entries(shortRatioStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([ratio, score]) => {
      const bar = '█'.repeat(Math.max(1, Math.floor((score + 10) * 3)));
      console.log(`  ${ratio}: ${score.toFixed(3)} ${bar}`);
    });

  // dailyLossStop 別平均複合スコア
  const dailyLossStopStats = {};
  GRID.dailyLossStop.forEach(stop => {
    const filtered = results.filter(r => r.params.dailyLossStop === stop);
    const avgScore = filtered.reduce((sum, r) => sum + r.objectiveScore, 0) / filtered.length;
    dailyLossStopStats[(stop * 100).toFixed(0) + '%'] = avgScore;
  });

  console.log('\ndailyLossStop（日次損失ストップ）別平均複合スコア:');
  Object.entries(dailyLossStopStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([stop, score]) => {
      const bar = '█'.repeat(Math.max(1, Math.floor((score + 10) * 3)));
      console.log(`  ${stop}: ${score.toFixed(3)} ${bar}`);
    });

  // JSON 出力
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    optimizationDate: new Date().toISOString(),
    period: {
      start: oneMonthAgo.toISOString().split('T')[0],
      end: today.toISOString().split('T')[0]
    },
    gridSizes: {
      lambdaReg: GRID.lambdaReg.length,
      nFactors: GRID.nFactors.length,
      quantile: GRID.quantile.length,
      shortRatio: GRID.shortRatio.length,
      dailyLossStop: GRID.dailyLossStop.length,
      useEwma: GRID.useEwma.length,
      ewmaHalflife: GRID.ewmaHalflife.length,
      total: totalIterations
    },
    optimalParameters: best.params,
    optimalMetrics: {
      objectiveScore: best.objectiveScore,
      totalReturn: best.totalReturn,
      sharpeRatio: best.sharpeRatio,
      winRate: best.winRate,
      maxDrawdown: best.maxDrawdown,
      annualizedReturn: best.metrics.AR,
      annualizedVolatility: best.metrics.RISK
    },
    top10Results: results.slice(0, 10),
    sensitivityAnalysis: {
      lambdaReg: lambdaRegStats,
      shortRatio: shortRatioStats,
      dailyLossStop: dailyLossStopStats
    },
    allResults: results
  };

  const outputPath = path.join(outputDir, `optimal_parameters_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 結果を保存しました：${outputPath}`);

  // 推奨設定
  console.log('\n' + '='.repeat(80));
  console.log('💡 推奨設定');
  console.log('='.repeat(80));
  console.log('\n以下のパラメータを推奨します：');
  console.log('\n```javascript');
  console.log('{');
  console.log(`  lambdaReg: ${best.params.lambdaReg.toFixed(1)},`);
  console.log(`  nFactors: ${best.params.nFactors},`);
  console.log(`  quantile: ${best.params.quantile.toFixed(1)},`);
  console.log(`  shortRatio: ${best.params.shortRatio.toFixed(1)},`);
  console.log(`  dailyLossStop: ${best.params.dailyLossStop.toFixed(2)},`);
  console.log(`  useEwma: ${best.params.useEwma},`);
  console.log(`  ewmaHalflife: ${best.params.ewmaHalflife}`);
  console.log('}');
  console.log('```');

  logger.info('Parameter optimization completed', {
    bestParams: best.params,
    bestSharpeRatio: best.sharpeRatio,
    totalIterations
  });
}

main().catch(error => {
  logger.error('Parameter optimization failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
