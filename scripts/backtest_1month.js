/**
 * 直近 1 ヶ月バックテスト
 */

'use strict';

const { runBacktest } = require('../backtest/real');
const {
  fetchOhlcvDateRangeForTickers,
  buildReturnMatricesFromOhlcv,
  computeCFull
} = require('../lib/data');
const { config: defaultConfig } = require('../lib/config');
const { computePerformanceMetrics } = require('../lib/portfolio');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');

async function run1MonthBacktest() {
  console.log('='.repeat(60));
  console.log('日米業種リードラグ戦略 - 直近 1 ヶ月バックテスト');
  console.log('='.repeat(60));

  // 日付設定（直近 3 ヶ月取得）
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  console.log(`\nデータ期間：${startDateStr} ~ ${endDateStr}`);

  // データ取得
  console.log('\nデータ取得中...');
  const usEtfTickers = Object.keys(US_ETF_TICKERS);
  const jpEtfTickers = Object.keys(JP_ETF_TICKERS);

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvDateRangeForTickers(usEtfTickers, startDateStr, endDateStr, defaultConfig),
    fetchOhlcvDateRangeForTickers(jpEtfTickers, startDateStr, endDateStr, defaultConfig)
  ]);

  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;

  // リターン行列作成
  console.log('リターン計算中...');
  const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc, dates } = buildReturnMatricesFromOhlcv(usData, jpData, defaultConfig.backtest.jpWindowReturn);

  if (dates.length < 65) {
    console.error(`エラー：データが不足しています（必要：65 日、実際：${dates.length}日）`);
    return;
  }

  console.log(`データ期間：${dates[0]} ~ ${dates[dates.length - 1]}`);
  console.log(`総取引日数：${dates.length}日`);

  // 長期相関行列 C_full の計算（2010-2014 年データ使用）
  console.log('\n長期相関行列 C_full の計算中...');
  const [usResFull, jpResFull] = await Promise.all([
    fetchOhlcvDateRangeForTickers(usEtfTickers, '2010-01-01', '2014-12-31', defaultConfig),
    fetchOhlcvDateRangeForTickers(jpEtfTickers, '2010-01-01', '2014-12-31', defaultConfig)
  ]);
  const { retUs: returnsUsFull, retJp: returnsJpFull } = buildReturnMatricesFromOhlcv(
    usResFull.byTicker,
    jpResFull.byTicker,
    defaultConfig.backtest.jpWindowReturn
  );
  const CFull = computeCFull(returnsUsFull, returnsJpFull);

  // 設定
  const config = {
    ...defaultConfig,
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.4
  };

  // バックテスト実行
  console.log('\nバックテスト実行中...');
  const results = runBacktest(returnsUs, returnsJp, returnsJpOc, config, SECTOR_LABELS, CFull, 'PCA_SUB');

  if (!results || results.length === 0) {
    console.error('エラー：バックテスト結果がありません');
    return;
  }

  // パフォーマンス指標計算
  const strategyReturns = results.map(r => r.return);
  const metrics = computePerformanceMetrics(strategyReturns);

  // 結果表示
  console.log('\n' + '='.repeat(60));
  console.log(`期間：${results[0].date} ~ ${results[results.length - 1].date}`);
  console.log(`取引日数：${results.length}日`);
  console.log('='.repeat(60));
  console.log(`月率リターン：${(metrics.AR * 100).toFixed(2)}%`);
  console.log(`月率リスク：${(metrics.RISK * 100).toFixed(2)}%`);
  console.log(`リスク・リターン比：${(metrics['R/R']).toFixed(2)}`);
  console.log(`最大ドローダウン：${(metrics.MDD * 100).toFixed(2)}%`);
  console.log(`勝率：${(metrics['Win Rate'] * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  // 日次リターン詳細
  console.log('\n【日次リターン詳細】');
  let cumulative = 0;
  results.forEach(r => {
    cumulative += r.return;
    const sign = r.return >= 0 ? '+' : '';
    console.log(`${r.date}: ${sign}${(r.return * 100).toFixed(2)}% (累積：${(cumulative * 100).toFixed(2)}%)`);
  });

  // 損益日数
  const profitableDays = results.filter(r => r.return > 0).length;
  const lossDays = results.filter(r => r.return < 0).length;
  console.log(`\n収益日数：${profitableDays}日`);
  console.log(`損失日数：${lossDays}日`);

  // 最大収益日・最大損失日
  const bestDay = results.reduce((max, r) => r.return > max.return ? r : max, results[0]);
  const worstDay = results.reduce((min, r) => r.return < min.return ? r : min, results[0]);
  console.log(`\n最大収益日：${bestDay.date} (${(bestDay.return * 100).toFixed(2)}%)`);
  console.log(`最大損失日：${worstDay.date} (${(worstDay.return * 100).toFixed(2)}%)`);

  return results;
}

// 実行
run1MonthBacktest()
  .then(() => {
    console.log('\nバックテスト完了');
    process.exit(0);
  })
  .catch(err => {
    console.error('エラー:', err);
    process.exit(1);
  });
