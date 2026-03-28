/**
 * 改善版バックテスト（リスク管理機能付き）
 * 
 * 実装機能:
 * 1. 日次損失ストップ（-2% でポジション解消）
 * 2. ボラティリティ調整（高ボラ日はポジション縮小）
 * 3. ショート比率調整（0=ロングのみ、0.5=半分、1=通常）
 * 4. 成績不良セクター除外（過去 60 日で勝率・リターン基準）
 * 
 * Usage: node scripts/backtest_improved.js
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
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');
const { createLogger } = require('../lib/logger');
const {
  computePerformanceMetrics
} = require('../lib/portfolio');
const {
  calculateVolatility,
  calculateSectorPerformance,
  getExcludedTickers,
  buildPortfolioWithShortRatioAndFilter
} = require('../lib/backtestUtils');

const logger = createLogger('BacktestImproved');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;

/**
 * 改善版設定（最適パラメータ使用）
 */
const IMPROVED_CONFIG = {
  // 最適パラメータ（グリッドサーチ結果）
  lambdaReg: 0.7,
  nFactors: 1,
  quantile: 0.6,
  
  // リスク管理
  shortRatio: 1.0,           // ショート比率（0=ロングのみ）
  dailyLossStop: 0.02,       // 日次損失ストップ（2%）
  volatilityLookback: 20,    // ボラティリティ計算期間
  volatilityThreshold: 0.02, // ボラティリティ閾値（2%）
  volatilityReduction: 0.5,  // 高ボラ時のポジション縮小率
  
  // セクターフィルタ
  sectorFilterEnabled: true,
  sectorLookback: 60,        // セクター評価期間
  sectorMinWinRate: 0.3,     // 最小勝率
  sectorMinReturn: -0.001    // 最小平均リターン
};

/**
 * 改善版バックテスト実行
 */
function runImprovedBacktest(
  returnsUs,
  returnsJpOc,
  params,
  sectorLabels,
  CFull
) {
  const nJp = returnsJpOc[0].values.length;
  const strategyReturns = [];
  const dates = [];
  const dailyReturns = []; // ボラティリティ計算用
  let prevWeights = null;
  let positionClosed = false; // 損失ストップ発行フラグ

  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg,
    nFactors: params.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const windowLength = config.backtest.windowLength;
  const warmupPeriod = windowLength + params.sectorLookback;

  // セクターパフォーマンス計算（初回のみ）
  const sectorPerformance = calculateSectorPerformance(
    returnsJpOc,
    params.sectorLookback,
    warmupPeriod
  );
  const excludedIndices = getExcludedTickers(sectorPerformance, params);

  excludedIndices.forEach(idx => {
    const sp = Object.values(sectorPerformance).find(s => s.index === idx);
    if (sp) {
      logger.info(`除外銘柄：${sp.ticker} (${sp.name}) - 勝率：${(sp.winRate * 100).toFixed(1)}%, 平均リターン：${(sp.avgReturn * 100).toFixed(2)}%`);
    }
  });

  logger.info(`除外銘柄数：${excludedIndices.size} / ${nJp}`);

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

    // ボラティリティ計算
    const currentVol = calculateVolatility(dailyReturns, params.volatilityLookback);
    const isHighVol = currentVol > params.volatilityThreshold;

    // ポートフォリオ構築
    let weights = buildPortfolioWithShortRatioAndFilter(
      signal,
      params.quantile,
      params.shortRatio,
      excludedIndices
    );

    // 高ボラティリティ時はポジション縮小
    if (isHighVol) {
      for (let j = 0; j < weights.length; j++) {
        weights[j] *= params.volatilityReduction;
      }
      logger.debug(`Day ${i}: High volatility detected (${(currentVol * 100).toFixed(2)}%), reducing position`);
    }

    // 損失ストップ発動中はポジションフラット
    if (positionClosed) {
      weights = new Array(nJp).fill(0);
    }

    // シグナル平滑化
    const smoothingAlpha = 0.3;
    if (prevWeights && !positionClosed) {
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

    // 日次損失ストップチェック
    if (params.dailyLossStop > 0 && netReturn < -params.dailyLossStop) {
      logger.info(`Day ${i}: Loss stop triggered (${(netReturn * 100).toFixed(2)}% < -${(params.dailyLossStop * 100).toFixed(1)}%)`);
      netReturn = -params.dailyLossStop;
      positionClosed = true;
    } else {
      positionClosed = false;
    }

    prevWeights = weights;
    dailyReturns.push(netReturn);

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: netReturn,
      volatility: currentVol,
      isHighVol,
      positionClosed
    });
    dates.push(returnsJpOc[i].date);
  }

  const returns = strategyReturns.map(r => r.return);
  const metrics = computePerformanceMetrics(returns);

  return {
    params,
    metrics,
    returns: strategyReturns,
    dates,
    excludedIndices: Array.from(excludedIndices),
    totalReturn: metrics.Cumulative - 1,
    sharpeRatio: metrics.RR,
    maxDrawdown: metrics.MDD,
    winRate: strategyReturns.filter(r => r.return > 0).length / strategyReturns.length
  };
}

/**
 * 通常版バックテスト（比較用）
 */
function runStandardBacktest(
  returnsUs,
  returnsJpOc,
  params,
  sectorLabels,
  CFull
) {
  const nJp = returnsJpOc[0].values.length;
  const strategyReturns = [];
  const dates = [];
  let prevWeights = null;

  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg,
    nFactors: params.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const windowLength = config.backtest.windowLength;
  const warmupPeriod = windowLength;

  for (let i = warmupPeriod; i < returnsJpOc.length; i++) {
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

    // 通常版：シンプルにポートフォリオ構築
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

    const retOc = returnsJpOc[i].values;
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      if (weights[j] !== 0) {
        portfolioReturn += weights[j] * retOc[j];
      }
    }

    const turnover = weights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
    const cost = turnover * (TRANSACTION_COST_RATE + SLIPPAGE_RATE);
    const netReturn = portfolioReturn - cost;

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: netReturn
    });
    dates.push(returnsJpOc[i].date);
  }

  const returns = strategyReturns.map(r => r.return);
  const metrics = computePerformanceMetrics(returns);

  return {
    params,
    metrics,
    returns: strategyReturns,
    dates,
    totalReturn: metrics.Cumulative - 1,
    sharpeRatio: metrics.RR,
    maxDrawdown: metrics.MDD,
    winRate: strategyReturns.filter(r => r.return > 0).length / strategyReturns.length
  };
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 改善版バックテスト（リスク管理機能付き）');
  console.log('='.repeat(80));

  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  console.log(`\n📅 評価期間：${oneMonthAgo.toISOString().split('T')[0]} ~ ${today.toISOString().split('T')[0]}`);
  console.log('\n📋 改善機能:');
  console.log(`  1. 日次損失ストップ：${(IMPROVED_CONFIG.dailyLossStop * 100).toFixed(1)}%`);
  console.log(`  2. ボラティリティ調整：閾値${(IMPROVED_CONFIG.volatilityThreshold * 100).toFixed(1)}%, 縮小率${(IMPROVED_CONFIG.volatilityReduction * 100).toFixed(0)}%`);
  console.log(`  3. ショート比率：${IMPROVED_CONFIG.shortRatio.toFixed(1)}`);
  console.log(`  4. セクターフィルタ：${IMPROVED_CONFIG.sectorFilterEnabled ? '有効' : '無効'}`);
  console.log(`     - 最小勝率：${(IMPROVED_CONFIG.sectorMinWinRate * 100).toFixed(1)}%`);
  console.log(`     - 最小平均リターン：${(IMPROVED_CONFIG.sectorMinReturn * 100).toFixed(2)}%`);

  // データ取得
  const winDays = IMPROVED_CONFIG.sectorLookback + config.backtest.windowLength + 80;
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

  // 相関行列計算
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  // 通常版バックテスト
  console.log('\n📊 通常版バックテスト実行中...');
  const standardParams = {
    lambdaReg: config.backtest.lambdaReg,
    nFactors: config.backtest.nFactors,
    quantile: config.backtest.quantile
  };

  const standardResult = runStandardBacktest(
    retUs,
    retJpOc,
    standardParams,
    config.sectorLabels,
    CFull
  );

  // 改善版バックテスト
  console.log('\n🚀 改善版バックテスト実行中...');
  const improvedResult = runImprovedBacktest(
    retUs,
    retJpOc,
    IMPROVED_CONFIG,
    config.sectorLabels,
    CFull
  );

  // 結果比較
  console.log('\n' + '='.repeat(80));
  console.log('📊 結果比較');
  console.log('='.repeat(80));

  console.log('\n指標            通常版        改善版        差分');
  console.log('-'.repeat(80));

  const compare = (label, std, imp) => {
    const diff = imp - std;
    const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
    console.log(`${label.padEnd(14)} ${std.toFixed(2).padStart(10)}  ${imp.toFixed(2).padStart(10)}  ${diffStr.padStart(10)}`);
  };

  compare('総利回り (%)', standardResult.totalReturn * 100, improvedResult.totalReturn * 100);
  compare('シャープレシオ', standardResult.sharpeRatio, improvedResult.sharpeRatio);
  compare('勝率 (%)', standardResult.winRate * 100, improvedResult.winRate * 100);
  compare('最大 DD (%)', standardResult.maxDrawdown * 100, improvedResult.maxDrawdown * 100);

  console.log('\n' + '='.repeat(80));
  console.log('📋 除外銘柄リスト（改善版）');
  console.log('='.repeat(80));

  if (improvedResult.excludedIndices.length > 0) {
    improvedResult.excludedIndices.forEach(idx => {
      const ticker = JP_ETF_TICKERS[idx];
      const name = JP_ETF_NAMES[ticker];
      console.log(`  ${ticker} (${name})`);
    });
  } else {
    console.log('  除外銘柄なし');
  }

  // 日次損益詳細（直近 10 日）
  console.log('\n' + '='.repeat(80));
  console.log('📊 日次損益詳細（直近 10 日）');
  console.log('='.repeat(80));

  console.log('日付         通常版 (%)    改善版 (%)    ボラティリティ  高ボラ  ストップ');
  console.log('-'.repeat(80));

  const recentDays = Math.min(10, improvedResult.returns.length);
  for (let i = improvedResult.returns.length - recentDays; i < improvedResult.returns.length; i++) {
    const stdRet = standardResult.returns[i]?.return || 0;
    const impRet = improvedResult.returns[i];
    console.log(
      `${impRet.date}  ${(stdRet * 100).toFixed(2).padStart(9)}  ${(impRet.return * 100).toFixed(2).padStart(9)}  ` +
      `${(impRet.volatility * 100).toFixed(2).padStart(10)}  ${impRet.isHighVol ? '✓' : '✗'.padStart(5)}  ${impRet.positionClosed ? '発動' : '-'.padStart(5)}`
    );
  }

  // JSON 出力
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    calculationDate: new Date().toISOString(),
    period: {
      start: oneMonthAgo.toISOString().split('T')[0],
      end: today.toISOString().split('T')[0]
    },
    improvedConfig: IMPROVED_CONFIG,
    standardResult: {
      params: standardParams,
      totalReturn: standardResult.totalReturn,
      sharpeRatio: standardResult.sharpeRatio,
      winRate: standardResult.winRate,
      maxDrawdown: standardResult.maxDrawdown,
      cumulativeReturn: standardResult.metrics.Cumulative,
      annualizedReturn: standardResult.metrics.AR,
      annualizedVolatility: standardResult.metrics.RISK
    },
    improvedResult: {
      params: IMPROVED_CONFIG,
      totalReturn: improvedResult.totalReturn,
      sharpeRatio: improvedResult.sharpeRatio,
      winRate: improvedResult.winRate,
      maxDrawdown: improvedResult.maxDrawdown,
      cumulativeReturn: improvedResult.metrics.Cumulative,
      annualizedReturn: improvedResult.metrics.AR,
      annualizedVolatility: improvedResult.metrics.RISK,
      excludedIndices: improvedResult.excludedIndices,
      excludedTickers: improvedResult.excludedIndices.map(idx => ({
        ticker: JP_ETF_TICKERS[idx],
        name: JP_ETF_NAMES[JP_ETF_TICKERS[idx]]
      }))
    },
    comparison: {
      totalReturnDiff: improvedResult.totalReturn - standardResult.totalReturn,
      sharpeRatioDiff: improvedResult.sharpeRatio - standardResult.sharpeRatio,
      winRateDiff: improvedResult.winRate - standardResult.winRate,
      maxDrawdownDiff: improvedResult.maxDrawdown - standardResult.maxDrawdown
    },
    dailyReturns: {
      standard: standardResult.returns,
      improved: improvedResult.returns
    }
  };

  const outputPath = path.join(outputDir, `backtest_improved_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 結果を保存しました：${outputPath}`);

  // 結論
  console.log('\n' + '='.repeat(80));
  console.log('💡 結論');
  console.log('='.repeat(80));

  const sharpeImproved = improvedResult.sharpeRatio > standardResult.sharpeRatio;
  const returnImproved = improvedResult.totalReturn > standardResult.totalReturn;
  const ddImproved = improvedResult.maxDrawdown > standardResult.maxDrawdown; // 負の値なので大きい方がマシ

  if (sharpeImproved && returnImproved) {
    console.log('✅ 改善版は通常版をアウトパフォームしました！');
    console.log(`   シャープレシオ：${standardResult.sharpeRatio.toFixed(2)} → ${improvedResult.sharpeRatio.toFixed(2)} (${((improvedResult.sharpeRatio / standardResult.sharpeRatio - 1) * 100).toFixed(0)}% 向上)`);
    console.log(`   総利回り：${(standardResult.totalReturn * 100).toFixed(2)}% → ${(improvedResult.totalReturn * 100).toFixed(2)}%`);
  } else if (sharpeImproved) {
    console.log('✅ 改善版はリスク調整後リターンで上回りました');
    console.log(`   シャープレシオ：${standardResult.sharpeRatio.toFixed(2)} → ${improvedResult.sharpeRatio.toFixed(2)}`);
  } else {
    console.log('⚠️ 改善版の効果は限定的でした');
    console.log('   パラメータチューニングの再検討が必要です');
  }

  if (ddImproved) {
    console.log(`\n🛡️ 最大ドローダウン：${(standardResult.maxDrawdown * 100).toFixed(2)}% → ${(improvedResult.maxDrawdown * 100).toFixed(2)}%`);
    console.log('   リスク管理機能が機能しています');
  }

  console.log('='.repeat(80));

  logger.info('Improved backtest completed', {
    standard: {
      totalReturn: standardResult.totalReturn,
      sharpeRatio: standardResult.sharpeRatio
    },
    improved: {
      totalReturn: improvedResult.totalReturn,
      sharpeRatio: improvedResult.sharpeRatio
    },
    improvement: {
      totalReturnDiff: improvedResult.totalReturn - standardResult.totalReturn,
      sharpeRatioDiff: improvedResult.sharpeRatio - standardResult.sharpeRatio
    }
  });
}

main().catch(error => {
  logger.error('Improved backtest failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
