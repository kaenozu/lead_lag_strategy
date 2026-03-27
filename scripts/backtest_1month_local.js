/**
 * 直近 1 ヶ月バックテスト - 既存データ使用
 * data/ ディレクトリの CSV データを使用して直近 1 ヶ月の収益を計算
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { runBacktest } = require('../backtest/real');
const {
  buildReturnMatricesFromOhlcv,
  computeCFull
} = require('../backtest/common');
const { config: defaultConfig } = require('../lib/config');
const { computePerformanceMetrics } = require('../lib/portfolio');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');
const { loadCSV } = require('../lib/data');

/**
 * ローカルデータ読み込み
 */
function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const data = loadCSV(filePath);
      results[ticker] = data.map(row => ({
        date: row.Date || row.date,
        open: row.Open || row.open,
        high: row.High || row.high,
        low: row.Low || row.low,
        close: row.Close || row.close,
        volume: row.Volume || row.volume || 0
      }));
      console.log(`Loaded ${ticker}: ${results[ticker].length} days`);
    } else {
      console.warn(`File not found: ${ticker}`);
      results[ticker] = [];
    }
  }
  return results;
}

function run1MonthBacktest() {
  console.log('='.repeat(60));
  console.log('日米業種リードラグ戦略 - 直近 1 ヶ月バックテスト');
  console.log('='.repeat(60));

  const dataDir = path.resolve(__dirname, '..', 'data');

  // ローカルデータ読み込み
  console.log('\nローカルデータ読み込み中...');
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  // リターン行列作成
  console.log('リターン計算中...');
  const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc, dates } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    defaultConfig.backtest.jpWindowReturn
  );

  if (dates.length < 65) {
    console.error(`エラー：データが不足しています（必要：65 日、実際：${dates.length}日）`);
    return;
  }

  // 直近 1 ヶ月（約 21 営業日）を抽出
  const recentDays = 21;
  const startIndex = Math.max(defaultConfig.backtest.windowLength, dates.length - recentDays - defaultConfig.backtest.windowLength);
  const endIndex = dates.length;
  
  const recentDates = dates.slice(startIndex, endIndex);
  const returnsUsRecent = returnsUs.slice(startIndex, endIndex);
  const returnsJpRecent = returnsJp.slice(startIndex, endIndex);
  const returnsJpOcRecent = returnsJpOc.slice(startIndex, endIndex);

  console.log(`全データ期間：${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length}日)`);
  console.log(`バックテスト期間：${recentDates[0]} ~ ${recentDates[recentDates.length - 1]} (${recentDates.length}日)`);

  // 長期相関行列 C_full の計算（2010-2014 年データ使用）
  console.log('\n長期相関行列 C_full の計算中...');
  const usDataFull = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpDataFull = loadLocalData(dataDir, JP_ETF_TICKERS);
  const { retUs: returnsUsFull, retJp: returnsJpFull } = buildReturnMatricesFromOhlcv(
    usDataFull,
    jpDataFull,
    defaultConfig.backtest.jpWindowReturn
  );
  const CFull = computeCFull(returnsUsFull, returnsJpFull);

  // 設定
  const config = {
    windowLength: defaultConfig.backtest.windowLength,
    nFactors: defaultConfig.backtest.nFactors,
    lambdaReg: defaultConfig.backtest.lambdaReg,
    quantile: defaultConfig.backtest.quantile,
    warmupPeriod: defaultConfig.backtest.windowLength,
    transactionCosts: defaultConfig.backtest.transactionCosts,
    orderedSectorKeys: defaultConfig.pca.orderedSectorKeys,
    signalStability: {
      smoothingAlpha: defaultConfig.backtest.smoothingAlpha,
      maxTurnoverPerDay: defaultConfig.backtest.maxTurnoverPerDay
    },
    riskLimits: {
      maxAbsWeight: defaultConfig.backtest.maxAbsWeight,
      dailyLossStop: defaultConfig.backtest.dailyLossStop
    }
  };

  // バックテスト実行
  console.log('\nバックテスト実行中...');
  const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, config, SECTOR_LABELS, CFull, 'PCA_SUB');

  if (!results || !results.returns || results.returns.length === 0) {
    console.error('エラー：バックテスト結果がありません');
    return;
  }

  // パフォーマンス指標計算
  const strategyReturns = results.returns.map(r => r.return);
  const metrics = computePerformanceMetrics(strategyReturns);

  // 結果表示
  console.log('\n' + '='.repeat(60));
  console.log(`期間：${results.returns[0].date} ~ ${results.returns[results.returns.length - 1].date}`);
  console.log(`取引日数：${results.returns.length}日`);
  console.log('='.repeat(60));
  console.log(`月率リターン：${(metrics.AR * 100).toFixed(2)}%`);
  console.log(`月率リスク：${(metrics.RISK * 100).toFixed(2)}%`);
  console.log(`リスク・リターン比：${(metrics.RR).toFixed(2)}`);
  console.log(`最大ドローダウン：${(metrics.MDD * 100).toFixed(2)}%`);
  console.log(`累積リターン：${((metrics.Cumulative - 1) * 100).toFixed(2)}%`);
  console.log('='.repeat(60));

  // 日次リターン詳細
  console.log('\n【日次リターン詳細】');
  let cumulative = 0;
  results.returns.forEach(r => {
    cumulative += r.return;
    const sign = r.return >= 0 ? '+' : '';
    console.log(`${r.date}: ${sign}${(r.return * 100).toFixed(2)}% (累積：${(cumulative * 100).toFixed(2)}%)`);
  });

  // 損益日数
  const profitableDays = results.returns.filter(r => r.return > 0).length;
  const lossDays = results.returns.filter(r => r.return < 0).length;
  console.log(`\n収益日数：${profitableDays}日`);
  console.log(`損失日数：${lossDays}日`);

  // 最大収益日・最大損失日
  const bestDay = results.returns.reduce((max, r) => r.return > max.return ? r : max, results.returns[0]);
  const worstDay = results.returns.reduce((min, r) => r.return < min.return ? r : min, results.returns[0]);
  console.log(`\n最大収益日：${bestDay.date} (${(bestDay.return * 100).toFixed(2)}%)`);
  console.log(`最大損失日：${worstDay.date} (${(worstDay.return * 100).toFixed(2)}%)`);

  return results;
}

// 実行
try {
  const results = run1MonthBacktest();
  console.log('\nバックテスト完了');
  process.exit(0);
} catch (err) {
  console.error('エラー:', err);
  process.exit(1);
}
