/**
 * 戦略深堀り分析 - 直近特化版
 * - 直近 1 年間の詳細分析
 * - 米国市場との相関分析
 * - 最適パラメータの検証
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

function recentDeepDive() {
  console.log('='.repeat(80));
  console.log('戦略深堀り分析 - 直近 1 年間特化');
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

  // 直近 1 年（252 営業日）を抽出
  const recentStart = Math.max(60, dates.length - 252);
  const recentDates = dates.slice(recentStart);
  const returnsUsRecent = returnsUs.slice(recentStart);
  const returnsJpRecent = returnsJp.slice(recentStart);
  const returnsJpOcRecent = returnsJpOc.slice(recentStart);

  console.log(`直近期間：${recentDates[0]} ~ ${recentDates[recentDates.length - 1]} (${recentDates.length}日)\n`);

  // ========================================================================
  // 1. 直近期パラメータ最適化
  // ========================================================================
  console.log('='.repeat(80));
  console.log('1. 直近期パラメータ最適化（λ×分位点）');
  console.log('='.repeat(80));

  const lambdaValues = [0.8, 0.85, 0.9, 0.95, 0.99];
  const quantileValues = [0.3, 0.35, 0.4, 0.45];
  
  const gridResults = [];
  
  console.log('\nグリッドサーチ実行中...');
  
  for (const lambda of lambdaValues) {
    for (const quantile of quantileValues) {
      const config = {
        windowLength: 60,
        nFactors: 3,
        lambdaReg: lambda,
        quantile: quantile,
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

      try {
        const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, config, SECTOR_LABELS, CFull, 'PCA_SUB');
        const metrics = computePerformanceMetrics(results.returns.map(r => r.return));
        gridResults.push({
          lambda,
          quantile,
          AR: metrics.AR * 100,
          RISK: metrics.RISK * 100,
          RR: metrics.RR,
          MDD: metrics.MDD * 100,
          Cumulative: (metrics.Cumulative - 1) * 100
        });
      } catch (e) {
        gridResults.push({
          lambda,
          quantile,
          AR: null,
          RISK: null,
          RR: null,
          MDD: null,
          Cumulative: null
        });
      }
    }
  }

  // グリッド結果表示
  console.log('\n【グリッドサーチ結果 - 年率リターン (%)】');
  console.log('λ＼Q  ' + quantileValues.map(q => q.toString().padStart(8)).join(''));
  console.log('-'.repeat(50));
  
  for (const lambda of lambdaValues) {
    let row = `${lambda.toString().padStart(5)}   `;
    for (const quantile of quantileValues) {
      const result = gridResults.find(r => r.lambda === lambda && r.quantile === quantile);
      row += (result.AR !== null ? result.AR.toFixed(2) : 'N/A').padStart(8) + ' ';
    }
    console.log(row);
  }

  // 最佳結果
  const validResults = gridResults.filter(r => r.AR !== null);
  const bestByAR = validResults.reduce((max, r) => r.AR > max.AR ? r : max, validResults[0]);
  const bestByRR = validResults.reduce((max, r) => r.RR > max.RR ? r : max, validResults[0]);
  const bestByMDD = validResults.reduce((min, r) => r.MDD > min.MDD ? r : min, validResults[0]);

  console.log('\n【直近期最佳パラメータ】');
  console.log(`最高 AR:  λ=${bestByAR.lambda}, Q=${bestByAR.quantile}, AR=${bestByAR.AR.toFixed(2)}%, R/R=${bestByAR.RR.toFixed(2)}`);
  console.log(`最高 R/R: λ=${bestByRR.lambda}, Q=${bestByRR.quantile}, AR=${bestByRR.AR.toFixed(2)}%, R/R=${bestByRR.RR.toFixed(2)}`);
  console.log(`最小 MDD: λ=${bestByMDD.lambda}, Q=${bestByMDD.quantile}, MDD=${bestByMDD.MDD.toFixed(2)}%, AR=${bestByMDD.AR.toFixed(2)}%`);

  // ========================================================================
  // 2. 米国市場との相関分析
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('2. 米国市場との相関分析');
  console.log('='.repeat(80));

  const baseConfig = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.99,
    quantile: 0.4,
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

  const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, baseConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const returns = results.returns;

  // 米国 ETF 別リターンと戦略リターンの相関
  console.log('\n【米国 ETF 別リターンと戦略の相関】');
  console.log('-'.repeat(50));

  const usCorrelations = {};
  const usTickers = Object.keys(US_ETF_TICKERS);
  
  for (const ticker of usTickers) {
    const usReturns = [];
    const stratReturns = [];
    
    for (let i = 60; i < returnsUsRecent.length && i < returns.length; i++) {
      const usRet = (returnsUsRecent[i].values[usTickers.indexOf(ticker)] || 0);
      const stratRet = returns[i - 60]?.return || 0;
      
      if (usRet !== 0 && stratRet !== undefined) {
        usReturns.push(usRet);
        stratReturns.push(stratRet);
      }
    }

    // 相関係数計算
    const n = usReturns.length;
    if (n > 10) {
      const meanUS = usReturns.reduce((a, b) => a + b, 0) / n;
      const meanStrat = stratReturns.reduce((a, b) => a + b, 0) / n;
      
      let cov = 0, varUS = 0, varStrat = 0;
      for (let i = 0; i < n; i++) {
        const diffUS = usReturns[i] - meanUS;
        const diffStrat = stratReturns[i] - meanStrat;
        cov += diffUS * diffStrat;
        varUS += diffUS * diffUS;
        varStrat += diffStrat * diffStrat;
      }
      
      const corr = cov / Math.sqrt(varUS * varStrat);
      usCorrelations[ticker] = corr;
    }
  }

  // 相関の強い順にソート
  const sortedCorr = Object.entries(usCorrelations)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  console.log('ETF    相関係数  影響度');
  console.log('-'.repeat(35));
  for (const [ticker, corr] of sortedCorr) {
    const impact = Math.abs(corr) > 0.3 ? '高' : (Math.abs(corr) > 0.1 ? '中' : '低');
    console.log(`${ticker.padEnd(6)} ${corr.toFixed(3).padStart(8)}  ${impact}`);
  }

  // 米国セクター別（シクリカル/ディフェンシブ）
  console.log('\n【セクタータイプ別相関】');
  const cyclicalCorr = [];
  const defensiveCorr = [];
  const neutralCorr = [];

  for (const [ticker, corr] of Object.entries(usCorrelations)) {
    const label = SECTOR_LABELS[`US_${ticker}`];
    if (label === 'cyclical') cyclicalCorr.push(corr);
    else if (label === 'defensive') defensiveCorr.push(corr);
    else neutralCorr.push(corr);
  }

  const avgCyclical = cyclicalCorr.reduce((a, b) => a + b, 0) / cyclicalCorr.length;
  const avgDefensive = defensiveCorr.reduce((a, b) => a + b, 0) / defensiveCorr.length;
  const avgNeutral = neutralCorr.reduce((a, b) => a + b, 0) / neutralCorr.length;

  console.log(`シクリカル  : ${avgCyclical.toFixed(3)} (${cyclicalCorr.length}ETF)`);
  console.log(`ディフェンシブ: ${avgDefensive.toFixed(3)} (${defensiveCorr.length}ETF)`);
  console.log(`ニュートラル  : ${avgNeutral.toFixed(3)} (${neutralCorr.length}ETF)`);

  // ========================================================================
  // 3. 直近月次パフォーマンス
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('3. 直近月次パフォーマンス（直近 12 ヶ月）');
  console.log('='.repeat(80));

  const monthlyData = {};
  for (const r of returns) {
    const month = r.date.substring(0, 7); // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = { returns: [], count: 0 };
    }
    monthlyData[month].returns.push(r.return);
    monthlyData[month].count++;
  }

  const sortedMonths = Object.keys(monthlyData).sort().slice(-12);

  console.log('\n【月次パフォーマンス】');
  console.log('-'.repeat(55));
  console.log('月份    リターン (%)  累積 (%)  勝率 (%)  日数');
  console.log('-'.repeat(55));

  let cumulative = 1;
  for (const month of sortedMonths) {
    const data = monthlyData[month];
    const monthRet = data.returns.reduce((a, b) => a + b, 0);
    cumulative *= (1 + monthRet);
    const winRate = data.returns.filter(r => r > 0).length / data.returns.length * 100;
    const sign = monthRet >= 0 ? '+' : '';
    console.log(`${month} ${sign}${(monthRet*100).toFixed(2).padStart(9)}  ${((cumulative-1)*100).toFixed(2).padStart(8)}  ${winRate.toFixed(0).padStart(6)}  ${data.count}`);
  }

  // ========================================================================
  // 4. 損失日深堀り
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('4. 損失日深堀り（直近 1 年）');
  console.log('='.repeat(80));

  const lossDaysDetailed = returns
    .map((r, i) => ({ date: r.date, return: r.return, index: i }))
    .filter(r => r.return < -0.005)
    .sort((a, b) => a.return - b.return);

  console.log('\n【ワースト 10 損失日】');
  console.log('-'.repeat(45));
  console.log('日付          リターン (%)  累積影響 (bp)');
  console.log('-'.repeat(45));

  for (let i = 0; i < Math.min(10, lossDaysDetailed.length); i++) {
    const day = lossDaysDetailed[i];
    const impactBp = day.return * 10000;
    console.log(`${day.date} ${((day.return)*100).toFixed(2).padStart(9)}  ${impactBp.toFixed(1).padStart(12)}`);
  }

  // 損失日の前日の米国市場
  console.log('\n【損失日前日の米国市場】');
  let usDownBeforeLoss = 0;
  let usUpBeforeLoss = 0;

  for (const day of lossDaysDetailed) {
    if (day.index > 0) {
      const usRetPrev = returnsUsRecent[day.index - 1]?.values.reduce((a, b) => a + b, 0) / usTickers.length;
      if (usRetPrev < 0) usDownBeforeLoss++;
      else usUpBeforeLoss++;
    }
  }

  const totalLossDays = usDownBeforeLoss + usUpBeforeLoss;
  console.log(`米国下落：${usDownBeforeLoss}日 (${(usDownBeforeLoss/totalLossDays*100).toFixed(1)}%)`);
  console.log(`米国上昇：${usUpBeforeLoss}日 (${(usUpBeforeLoss/totalLossDays*100).toFixed(1)}%)`);

  // ========================================================================
  // 5. 収益日深堀り
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('5. 収益日深堀り（直近 1 年）');
  console.log('='.repeat(80));

  const gainDaysDetailed = returns
    .map((r, i) => ({ date: r.date, return: r.return, index: i }))
    .filter(r => r.return > 0.005)
    .sort((a, b) => b.return - a.return);

  console.log('\n【ベスト 10 収益日】');
  console.log('-'.repeat(45));
  console.log('日付          リターン (%)  累積影響 (bp)');
  console.log('-'.repeat(45));

  for (let i = 0; i < Math.min(10, gainDaysDetailed.length); i++) {
    const day = gainDaysDetailed[i];
    const impactBp = day.return * 10000;
    console.log(`${day.date} ${((day.return)*100).toFixed(2).padStart(9)}  ${impactBp.toFixed(1).padStart(12)}`);
  }

  // 収益日の前日の米国市場
  console.log('\n【収益日前日の米国市場】');
  let usDownBeforeGain = 0;
  let usUpBeforeGain = 0;

  for (const day of gainDaysDetailed) {
    if (day.index > 0) {
      const usRetPrev = returnsUsRecent[day.index - 1]?.values.reduce((a, b) => a + b, 0) / usTickers.length;
      if (usRetPrev < 0) usDownBeforeGain++;
      else usUpBeforeGain++;
    }
  }

  const totalGainDays = usDownBeforeGain + usUpBeforeGain;
  console.log(`米国下落：${usDownBeforeGain}日 (${(usDownBeforeGain/totalGainDays*100).toFixed(1)}%)`);
  console.log(`米国上昇：${usUpBeforeGain}日 (${(usUpBeforeGain/totalGainDays*100).toFixed(1)}%)`);

  // ========================================================================
  // 6. 推奨アクション
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('6. 推奨アクション（直近期）');
  console.log('='.repeat(80));

  console.log('\n【パラメータ推奨】');
  console.log(`λ（正則化強度）: ${bestByRR.lambda}`);
  console.log(`分位点：${bestByRR.quantile}`);
  console.log(`期待年率リターン：${bestByRR.AR.toFixed(2)}%`);
  console.log(`期待 R/R 比：${bestByRR.RR.toFixed(2)}`);

  console.log('\n【米国市場活用】');
  const highCorrETFs = sortedCorr.filter(([_, c]) => Math.abs(c) > 0.2);
  if (highCorrETFs.length > 0) {
    console.log('高相関 ETF（監視推奨）:');
    highCorrETFs.slice(0, 5).forEach(([ticker, corr]) => {
      console.log(`  - ${ticker}: ${corr.toFixed(3)}`);
    });
  }

  console.log('\n【リスク管理】');
  const maxLoss = Math.min(...returns.map(r => r.return));
  const avgLoss = returns.filter(r => r.return < 0).length > 0 ? 
    returns.filter(r => r.return < 0).reduce((a, b) => a + b, 0) / returns.filter(r => r.return < 0).length : 0;
  console.log(`最大損失日：${(maxLoss*100).toFixed(2)}%`);
  console.log(`平均損失日：${(avgLoss*100).toFixed(2)}%`);
  console.log(`推奨ストップロス：${(Math.abs(maxLoss)*1.5*100).toFixed(2)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('分析完了');
  console.log('='.repeat(80));
}

try {
  recentDeepDive();
  process.exit(0);
} catch (err) {
  console.error('エラー:', err);
  console.error(err.stack);
  process.exit(1);
}
