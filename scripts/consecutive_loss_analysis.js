/**
 * 連続損失ルール詳細分析
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
    } else {
      results[ticker] = [];
    }
  }
  return results;
}

function consecutiveLossAnalysis() {
  console.log('='.repeat(80));
  console.log('連続損失ルール詳細分析');
  console.log('='.repeat(80));

  const dataDir = path.resolve(__dirname, '..', 'data');

  // データ読み込み
  console.log('\nデータ読み込み中...');
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
  const { retUs: returnsUs, retJp: returnsJp, retJpOc: returnsJpOc, dates } = buildReturnMatricesFromOhlcv(
    usData, jpData, defaultConfig.backtest.jpWindowReturn
  );

  // C_full 計算
  const usDataFull = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpDataFull = loadLocalData(dataDir, JP_ETF_TICKERS);
  const { retUs: returnsUsFull, retJp: returnsJpFull } = buildReturnMatricesFromOhlcv(
    usDataFull, jpDataFull, defaultConfig.backtest.jpWindowReturn
  );
  const CFull = computeCFull(returnsUsFull, returnsJpFull);

  console.log(`全期間：${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length}日)\n`);

  // ベースライン設定
  const baseConfig = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.80,
    quantile: 0.45,
    warmupPeriod: 60,
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

  // ベースライン実行
  console.log('ベースライン実行中...');
  const baseResults = runBacktest(returnsUs, returnsJp, returnsJpOc, baseConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const baseMetrics = computePerformanceMetrics(baseResults.returns.map(r => r.return));
  console.log(`ベースライン AR: ${(baseMetrics.AR*100).toFixed(2)}%, R/R: ${baseMetrics.RR.toFixed(2)}, 累積：${((baseMetrics.Cumulative-1)*100).toFixed(2)}%\n`);

  // ========================================================================
  // 1. 連続損失ルールの詳細パラメータサーチ
  // ========================================================================
  console.log('='.repeat(80));
  console.log('1. 連続損失ルール パラメータサーチ');
  console.log('='.repeat(80));

  const ruleTests = [];
  
  // 閾値：2-7 日、削減率：25%-100%
  for (let threshold = 2; threshold <= 7; threshold++) {
    for (let reduction = 0.25; reduction <= 1.0; reduction += 0.25) {
      let cumulative = 1;
      let consecutiveLoss = 0;
      let positionSize = 1.0;
      const returns = [];
      
      for (let i = 0; i < baseResults.returns.length; i++) {
        const r = baseResults.returns[i];
        
        if (r.return < 0) {
          consecutiveLoss++;
          if (consecutiveLoss >= threshold) {
            positionSize = 1.0 - reduction;
          }
        } else {
          consecutiveLoss = 0;
          positionSize = 1.0;
        }
        
        const adjReturn = r.return * positionSize;
        returns.push(adjReturn);
        cumulative *= (1 + adjReturn);
      }
      
      const metrics = computePerformanceMetrics(returns);
      ruleTests.push({
        threshold,
        reduction,
        AR: metrics.AR * 100,
        RISK: metrics.RISK * 100,
        RR: metrics.RR,
        MDD: metrics.MDD * 100,
        Cumulative: (metrics.Cumulative - 1) * 100
      });
    }
  }

  // AR 順にソート
  ruleTests.sort((a, b) => b.AR - a.AR);

  console.log('\n【ルール別パフォーマンス（AR 順）】');
  console.log('閾値  削減率    AR(%)    RISK(%)   R/R      MDD(%)   累積 (%)');
  console.log('-'.repeat(70));
  
  for (let i = 0; i < Math.min(15, ruleTests.length); i++) {
    const t = ruleTests[i];
    console.log(`${String(t.threshold).padStart(4)}日  ${(t.reduction*100).toFixed(0).padStart(4)}%  ` +
      `${t.AR.toFixed(2).padStart(8)}  ${t.RISK.toFixed(2).padStart(8)}  ` +
      `${t.RR.toFixed(2).padStart(8)}  ${t.MDD.toFixed(2).padStart(8)}  ${t.Cumulative.toFixed(2).padStart(9)}`);
  }

  // 最佳ルール
  const bestRule = ruleTests[0];
  console.log(`\n【最佳ルール】`);
  console.log(`閾値：${bestRule.threshold}日、削減率：${bestRule.reduction*100}%`);
  console.log(`AR: ${bestRule.AR.toFixed(2)}%, R/R: ${bestRule.RR.toFixed(2)}, 累積：${bestRule.Cumulative.toFixed(2)}%`);

  // ========================================================================
  // 2. 最佳ルールの詳細分析
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('2. 最佳ルールの詳細分析');
  console.log('='.repeat(80));

  // 最佳ルールで再計算
  let cumulative = 1;
  let consecutiveLoss = 0;
  let positionSize = 1.0;
  const detailedReturns = [];
  const equityCurve = [];
  
  for (let i = 0; i < baseResults.returns.length; i++) {
    const r = baseResults.returns[i];
    
    if (r.return < 0) {
      consecutiveLoss++;
      if (consecutiveLoss >= bestRule.threshold) {
        positionSize = 1.0 - bestRule.reduction;
      }
    } else {
      consecutiveLoss = 0;
      positionSize = 1.0;
    }
    
    const adjReturn = r.return * positionSize;
    detailedReturns.push({
      date: r.date,
      original: r.return,
      adjusted: adjReturn,
      positionSize,
      consecutiveLoss
    });
    
    cumulative *= (1 + adjReturn);
    equityCurve.push({ date: r.date, equity: cumulative });
  }

  // 年間パフォーマンス
  const yearlyPerformance = {};
  for (const r of detailedReturns) {
    const year = r.date.substring(0, 4);
    if (!yearlyPerformance[year]) {
      yearlyPerformance[year] = { returns: [], count: 0 };
    }
    yearlyPerformance[year].returns.push(r.adjusted);
    yearlyPerformance[year].count++;
  }

  console.log('\n【年別パフォーマンス】');
  console.log('年份    累積 (%)   日数   勝率 (%)');
  console.log('-'.repeat(45));
  
  for (const year of Object.keys(yearlyPerformance).sort()) {
    const data = yearlyPerformance[year];
    const cum = data.returns.reduce((a, b) => (1 + a) * (1 + b), 1) - 1;
    const winRate = data.returns.filter(r => r > 0).length / data.returns.length * 100;
    console.log(`${year}  ${(cum*100).toFixed(2).padStart(9)}  ${String(data.count).padStart(4)}  ${winRate.toFixed(1).padStart(7)}`);
  }

  // 月次パフォーマンス（最新 12 ヶ月）
  const monthlyPerformance = {};
  for (const r of detailedReturns) {
    const month = r.date.substring(0, 7);
    if (!monthlyPerformance[month]) {
      monthlyPerformance[month] = { returns: [], count: 0 };
    }
    monthlyPerformance[month].returns.push(r.adjusted);
    monthlyPerformance[month].count++;
  }

  const sortedMonths = Object.keys(monthlyPerformance).sort().slice(-12);
  
  console.log('\n【月次パフォーマンス（直近 12 ヶ月）】');
  console.log('月份    累積 (%)   日数   勝率 (%)');
  console.log('-'.repeat(45));
  
  for (const month of sortedMonths) {
    const data = monthlyPerformance[month];
    const cum = data.returns.reduce((a, b) => (1 + a) * (1 + b), 1) - 1;
    const winRate = data.returns.filter(r => r > 0).length / data.returns.length * 100;
    const sign = cum >= 0 ? '+' : '';
    console.log(`${month}  ${sign}${(cum*100).toFixed(2).padStart(8)}  ${String(data.count).padStart(4)}  ${winRate.toFixed(1).padStart(7)}`);
  }

  // 損失削減効果
  const originalLossDays = detailedReturns.filter(r => r.original < -0.005);
  const reducedLossDays = originalLossDays.filter(r => r.positionSize < 1.0);
  
  let totalLossOriginal = 0;
  let totalLossReduced = 0;
  
  for (const r of originalLossDays) {
    totalLossOriginal += r.original;
    totalLossReduced += r.adjusted;
  }

  console.log('\n【損失削減効果】');
  console.log(`対象損失日数：${reducedLossDays.length}日（全${originalLossDays.length}日の${(reducedLossDays.length/originalLossDays.length*100).toFixed(1)}%）`);
  console.log(`元損失合計：${(totalLossOriginal*100).toFixed(2)}%`);
  console.log(`削減後損失合計：${(totalLossReduced*100).toFixed(2)}%`);
  console.log(`削減効果：${((totalLossOriginal - totalLossReduced)*100).toFixed(2)}%`);

  // ========================================================================
  // 3. 比較サマリー
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('3. 比較サマリー');
  console.log('='.repeat(80));

  console.log('\n【戦略比較】');
  console.log('指標          ベースライン   最佳ルール   改善');
  console.log('-'.repeat(55));
  console.log(`年率リターン   ${(baseMetrics.AR*100).toFixed(2).padStart(9)}%   ${bestRule.AR.toFixed(2).padStart(8)}%   ${((bestRule.AR - baseMetrics.AR*100)).toFixed(2).padStart(7)}%`);
  console.log(`年率リスク     ${(baseMetrics.RISK*100).toFixed(2).padStart(9)}%   ${bestRule.RISK.toFixed(2).padStart(8)}%   ${((bestRule.RISK - baseMetrics.RISK*100)).toFixed(2).padStart(7)}%`);
  console.log(`R/R 比         ${baseMetrics.RR.toFixed(2).padStart(9)}   ${bestRule.RR.toFixed(2).padStart(8)}   ${((bestRule.RR - baseMetrics.RR)).toFixed(2).padStart(7)}`);
  console.log(`最大 DD        ${(baseMetrics.MDD*100).toFixed(2).padStart(9)}%   ${bestRule.MDD.toFixed(2).padStart(8)}%   ${((bestRule.MDD - baseMetrics.MDD*100)).toFixed(2).padStart(7)}%`);
  console.log(`累積リターン   ${((baseMetrics.Cumulative-1)*100).toFixed(2).padStart(9)}%   ${bestRule.Cumulative.toFixed(2).padStart(8)}%   ${((bestRule.Cumulative - (baseMetrics.Cumulative-1)*100)).toFixed(2).padStart(7)}%`);

  // ========================================================================
  // 4. 推奨設定
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('4. 推奨設定');
  console.log('='.repeat(80));

  console.log('\n【推奨連続損失ルール】');
  console.log(`閾値：${bestRule.threshold}日連続損失`);
  console.log(`削減率：${bestRule.reduction*100}%`);
  console.log(`期待年率リターン：${bestRule.AR.toFixed(2)}%`);
  console.log(`期待 R/R 比：${bestRule.RR.toFixed(2)}`);
  console.log(`期待累積リターン：${bestRule.Cumulative.toFixed(2)}%`);

  console.log('\n【実装コード例】');
  console.log('```javascript');
  console.log('// 連続損失ルール');
  console.log('let consecutiveLoss = 0;');
  console.log('let positionSize = 1.0;');
  console.log('');
  console.log('for (const return of dailyReturns) {');
  console.log('  if (return < 0) {');
  console.log('    consecutiveLoss++;');
  console.log(`    if (consecutiveLoss >= ${bestRule.threshold}) {`);
  console.log(`      positionSize = ${1.0 - bestRule.reduction};  // ${bestRule.reduction*100}%削減`);
  console.log('    }');
  console.log('  } else {');
  console.log('    consecutiveLoss = 0;');
  console.log('    positionSize = 1.0;');
  console.log('  }');
  console.log('  // ポジションサイズを適用して取引');
  console.log('}');
  console.log('```');

  console.log('\n' + '='.repeat(80));
  console.log('分析完了');
  console.log('='.repeat(80));
}

try {
  consecutiveLossAnalysis();
  process.exit(0);
} catch (err) {
  console.error('エラー:', err);
  console.error(err.stack);
  process.exit(1);
}
