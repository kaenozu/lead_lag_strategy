/**
 * 単純モメンタム戦略（ベースライン）
 * 過去 N 日のリターンでランキングし、上位銘柄にロング、下位にショート
 * 
 * Usage: node scripts/strategy_simple_momentum.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

const { config } = require('../lib/config');
const {
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');
const { createLogger } = require('../lib/logger');
const { computePerformanceMetrics } = require('../lib/portfolio');

const logger = createLogger('SimpleMomentum');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;

/**
 * 戦略設定
 */
const STRATEGY_CONFIG = {
  momentumWindow: 20,    // モメンタム計算期間（日）
  quantile: 0.4,         // 上位 40% を取引
  rebalanceDays: 5,      // リバランス頻度（日）
  dailyLossStop: 0.02,   // 日次損失ストップ
  sectorFilterEnabled: true,
  sectorLookback: 60,
  sectorMinWinRate: 0.3,
  sectorMinReturn: -0.001
};

/**
 * モメンタム計算
 */
function calculateMomentum(returnsJpOc, index, window) {
  const momentum = new Array(returnsJpOc[0].values.length).fill(0);
  
  for (let j = 0; j < momentum.length; j++) {
    let sum = 0;
    for (let i = Math.max(0, index - window); i < index; i++) {
      sum += returnsJpOc[i].values[j];
    }
    momentum[j] = sum / Math.min(window, index);
  }
  
  return momentum;
}

/**
 * セクターパフォーマンス計算
 */
function calculateSectorPerformance(returnsJpOc, lookback, startDate) {
  const performance = {};
  
  JP_ETF_TICKERS.forEach((ticker, idx) => {
    const tickerReturns = [];
    for (let i = Math.max(0, startDate - lookback); i < Math.min(startDate + 30, returnsJpOc.length); i++) {
      tickerReturns.push(returnsJpOc[i].values[idx]);
    }
    
    const wins = tickerReturns.filter(r => r > 0).length;
    const total = tickerReturns.length;
    const avgReturn = total > 0 ? tickerReturns.reduce((a, b) => a + b, 0) / total : 0;
    
    performance[ticker] = {
      ticker,
      winRate: total > 0 ? wins / total : 0,
      avgReturn,
      index: idx
    };
  });
  
  return performance;
}

/**
 * 除外銘柄リスト作成
 */
function getExcludedTickers(sectorPerformance, config) {
  if (!config.sectorFilterEnabled) return new Set();
  
  const excluded = new Set();
  Object.values(sectorPerformance).forEach(sp => {
    if (sp.winRate < config.sectorMinWinRate || sp.avgReturn < config.sectorMinReturn) {
      excluded.add(sp.index);
    }
  });
  
  return excluded;
}

/**
 * ポートフォリオ構築
 */
function buildPortfolio(momentum, quantile, excludedIndices) {
  const n = momentum.length;
  const q = Math.max(1, Math.floor(n * quantile));
  
  const ranked = momentum
    .map((val, idx) => ({ val, idx }))
    .filter(x => !excludedIndices.has(x.idx))
    .sort((a, b) => a.val - b.val);

  if (ranked.length === 0) return new Array(n).fill(0);

  const actualQ = Math.max(1, Math.min(q, Math.floor(ranked.length * quantile)));

  const longIndices = ranked.slice(-actualQ).map(x => x.idx);
  const shortIndices = ranked.slice(0, actualQ).map(x => x.idx);

  const weights = new Array(n).fill(0);
  const w = 1.0 / actualQ;
  
  for (const idx of longIndices) weights[idx] = w;
  for (const idx of shortIndices) weights[idx] = -w;

  return weights;
}

/**
 * バックテスト実行
 */
function runBacktest(returnsJpOc, params) {
  const nJp = returnsJpOc[0].values.length;
  const strategyReturns = [];
  let prevWeights = null;
  let positionClosed = false;

  const warmupPeriod = Math.max(params.momentumWindow, params.sectorLookback);

  // セクターパフォーマンス計算
  const sectorPerformance = calculateSectorPerformance(returnsJpOc, params.sectorLookback, warmupPeriod);
  const excludedIndices = getExcludedTickers(sectorPerformance, params);

  logger.info(`除外銘柄数：${excludedIndices.size} / ${nJp}`);

  for (let i = warmupPeriod; i < returnsJpOc.length; i++) {
    // リバランス日のみ取引
    if ((i - warmupPeriod) % params.rebalanceDays !== 0) {
      // 前日のウェイトを維持
      if (prevWeights) {
        const retOc = returnsJpOc[i].values;
        let portfolioReturn = 0;
        for (let j = 0; j < prevWeights.length; j++) {
          if (prevWeights[j] !== 0) {
            portfolioReturn += prevWeights[j] * retOc[j];
          }
        }
        
        // 取引コスト
        const turnover = prevWeights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
        const cost = turnover * (TRANSACTION_COST_RATE + SLIPPAGE_RATE);
        let netReturn = portfolioReturn - cost;
        
        // 日次損失ストップ
        if (params.dailyLossStop > 0 && netReturn < -params.dailyLossStop) {
          netReturn = -params.dailyLossStop;
          positionClosed = true;
        } else if (positionClosed && netReturn > 0) {
          positionClosed = false;
        }
        
        strategyReturns.push({
          date: returnsJpOc[i].date,
          return: netReturn,
          isRebalanceDay: false
        });
      }
      continue;
    }

    // リバランス日
    const momentum = calculateMomentum(returnsJpOc, i, params.momentumWindow);
    let weights = buildPortfolio(momentum, params.quantile, excludedIndices);

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
    let netReturn = portfolioReturn - cost;

    // 日次損失ストップ
    if (params.dailyLossStop > 0 && netReturn < -params.dailyLossStop) {
      netReturn = -params.dailyLossStop;
      positionClosed = true;
    } else if (positionClosed && netReturn > 0) {
      positionClosed = false;
    }

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: netReturn,
      isRebalanceDay: true
    });
  }

  const returns = strategyReturns.map(r => r.return);
  const metrics = computePerformanceMetrics(returns);

  return {
    params,
    metrics,
    returns: strategyReturns,
    excludedIndices: Array.from(excludedIndices),
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
  console.log('📈 単純モメンタム戦略（ベースライン）');
  console.log('='.repeat(80));

  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  console.log(`\n📅 評価期間：${oneMonthAgo.toISOString().split('T')[0]} ~ ${today.toISOString().split('T')[0]}`);
  console.log(`\n📋 戦略設定:`);
  console.log(`  モメンタム期間：${STRATEGY_CONFIG.momentumWindow}日`);
  console.log(`  取引銘柄：上位・下位各${(STRATEGY_CONFIG.quantile * 100).toFixed(0)}%`);
  console.log(`  リバランス：${STRATEGY_CONFIG.rebalanceDays}日ごと`);

  // データ取得
  const winDays = 300;
  console.log(`\n📡 市場データ取得中...`);

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

  // パラメータグリッドサーチ
  console.log('\n🔍 パラメータグリッドサーチ中...');
  
  const momentumWindows = [10, 20, 40, 60];
  const quantiles = [0.3, 0.4, 0.5];
  
  let bestResult = null;
  let bestSharpe = -Infinity;

  for (const mw of momentumWindows) {
    for (const q of quantiles) {
      const params = { ...STRATEGY_CONFIG, momentumWindow: mw, quantile: q };
      const result = runBacktest(retJpOc, params);
      
      if (result.sharpeRatio > bestSharpe) {
        bestSharpe = result.sharpeRatio;
        bestResult = result;
      }
    }
  }

  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('📊 最適パラメータ');
  console.log('='.repeat(80));
  console.log(`モメンタム期間：${bestResult.params.momentumWindow}日`);
  console.log(`quantile: ${bestResult.params.quantile.toFixed(1)}`);

  console.log('\n' + '='.repeat(80));
  console.log('📊 パフォーマンス');
  console.log('='.repeat(80));
  console.log(`総利回り：${(bestResult.totalReturn * 100).toFixed(2)}%`);
  console.log(`シャープレシオ：${bestResult.sharpeRatio.toFixed(2)}`);
  console.log(`勝率：${(bestResult.winRate * 100).toFixed(1)}%`);
  console.log(`最大ドローダウン：${(bestResult.maxDrawdown * 100).toFixed(2)}%`);

  // 除外銘柄
  console.log('\n' + '='.repeat(80));
  console.log('📋 除外銘柄（セクターフィルタ）');
  console.log('='.repeat(80));

  if (bestResult.excludedIndices.length > 0) {
    bestResult.excludedIndices.forEach(idx => {
      const ticker = JP_ETF_TICKERS[idx];
      console.log(`  ${ticker} (${JP_ETF_NAMES[ticker]})`);
    });
  } else {
    console.log('  除外銘柄なし');
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
    strategy: 'Simple Momentum',
    optimalParams: {
      momentumWindow: bestResult.params.momentumWindow,
      quantile: bestResult.params.quantile
    },
    performance: {
      totalReturn: bestResult.totalReturn,
      sharpeRatio: bestResult.sharpeRatio,
      winRate: bestResult.winRate,
      maxDrawdown: bestResult.maxDrawdown
    },
    excludedTickers: bestResult.excludedIndices.map(idx => ({
      ticker: JP_ETF_TICKERS[idx],
      name: JP_ETF_NAMES[JP_ETF_TICKERS[idx]]
    }))
  };

  const outputPath = path.join(outputDir, `simple_momentum_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 結果を保存しました：${outputPath}`);

  console.log('\n' + '='.repeat(80));
  console.log('💡 結論');
  console.log('='.repeat(80));

  if (bestResult.sharpeRatio > 0) {
    console.log('✅ 単純モメンタム戦略はプラスのシャープレシオを記録しました');
    console.log('   現行戦略（PCA）との比較を検討してください');
  } else {
    console.log('⚠️ 単純モメンタム戦略もマイナスのシャープレシオ');
    console.log('   市場環境全体の課題可能性があります');
  }

  console.log('='.repeat(80));

  logger.info('Simple momentum strategy completed', {
    momentumWindow: bestResult.params.momentumWindow,
    sharpeRatio: bestResult.sharpeRatio
  });
}

main().catch(error => {
  logger.error('Simple momentum strategy failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
