/**
 * 戦略強化分析スクリプト
 * - 季節性調整のバックテスト
 * - 連続損失ルールの検証
 * - ボラティリティ制御のテスト
 * - 複合戦略の評価
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

function buildPortfolio(signal, quantile) {
  const n = signal.length;
  const sortedIndices = signal
    .map((v, i) => ({ value: v, index: i }))
    .sort((a, b) => b.value - a.value);

  const weights = new Array(n).fill(0);
  const longCount = Math.floor(n * quantile);
  const shortCount = Math.floor(n * quantile);

  for (let i = 0; i < longCount; i++) {
    weights[sortedIndices[i].index] = 1.0 / longCount;
  }
  for (let i = 0; i < shortCount; i++) {
    weights[sortedIndices[n - 1 - i].index] = -1.0 / shortCount;
  }

  return weights;
}

function strategyEnhancement() {
  console.log('='.repeat(80));
  console.log('戦略強化分析');
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
  console.log(`ベースライン AR: ${(baseMetrics.AR*100).toFixed(2)}%, R/R: ${baseMetrics.RR.toFixed(2)}`);

  // ========================================================================
  // 1. 季節性調整のバックテスト
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('1. 季節性調整のバックテスト');
  console.log('='.repeat(80));

  // 月次パフォーマンス分析
  const monthlyPerformance = {};
  for (let i = 0; i < baseResults.returns.length; i++) {
    const r = baseResults.returns[i];
    const month = r.date.substring(5, 7);
    if (!monthlyPerformance[month]) {
      monthlyPerformance[month] = { returns: [], count: 0 };
    }
    monthlyPerformance[month].returns.push(r.return);
    monthlyPerformance[month].count++;
  }

  console.log('\n【月次パフォーマンス分析】');
  const monthNames = {
    '01': '1 月', '02': '2 月', '03': '3 月', '04': '4 月',
    '05': '5 月', '06': '6 月', '07': '7 月', '08': '8 月',
    '09': '9 月', '10': '10 月', '11': '11 月', '12': '12 月'
  };

  const monthlyAdj = {};
  for (const [month, data] of Object.entries(monthlyPerformance)) {
    const avgRet = data.returns.reduce((a, b) => a + b, 0) / data.returns.length;
    // 平均リターンが負の月はポジション削減、正の月は拡大
    let adj = 1.0;
    if (avgRet < -0.002) adj = 0.5;  // 大きく負ける月は 50% 削減
    else if (avgRet > 0.003) adj = 1.2;  // 大きく勝つ月は 20% 拡大
    
    monthlyAdj[month] = { avgRet: avgRet * 100, adjustment: adj };
    console.log(`${monthNames[month]}: 平均${(avgRet*100).toFixed(2)}%, 調整係数${adj.toFixed(1)}`);
  }

  // 季節性調整ありのバックテスト（簡易版）
  console.log('\n【季節性調整パフォーマンス】');
  let cumulativeWithAdj = 1;
  let cumulativeBase = 1;
  
  for (let i = 0; i < baseResults.returns.length; i++) {
    const r = baseResults.returns[i];
    const month = r.date.substring(5, 7);
    const adj = monthlyAdj[month].adjustment;
    
    // 調整後リターン
    const adjReturn = r.return * adj;
    cumulativeWithAdj *= (1 + adjReturn);
    cumulativeBase *= (1 + r.return);
  }

  const totalReturnAdj = (cumulativeWithAdj - 1) * 100;
  const totalReturnBase = (cumulativeBase - 1) * 100;
  
  console.log(`ベースライン累積：${totalReturnBase.toFixed(2)}%`);
  console.log(`季節性調整後累积：${totalReturnAdj.toFixed(2)}%`);
  console.log(`改善効果：${(totalReturnAdj - totalReturnBase).toFixed(2)}%`);

  // ========================================================================
  // 2. 連続損失ルールの検証
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('2. 連続損失ルールの検証');
  console.log('='.repeat(80));

  // 連続損失パターン分析
  let consecutiveLoss = 0;
  const consecutiveLossData = [];
  
  for (let i = 0; i < baseResults.returns.length; i++) {
    const r = baseResults.returns[i];
    if (r.return < 0) {
      consecutiveLoss++;
    } else {
      if (consecutiveLoss > 0) {
        consecutiveLossData.push(consecutiveLoss);
      }
      consecutiveLoss = 0;
    }
  }
  if (consecutiveLoss > 0) consecutiveLossData.push(consecutiveLoss);

  // 連続損失のカウント
  const consecutiveCount = {};
  for (const c of consecutiveLossData) {
    consecutiveCount[c] = (consecutiveCount[c] || 0) + 1;
  }

  console.log('\n【連続損失パターン】');
  console.log('連続日数  発生回数  累積発生率');
  console.log('-'.repeat(40));
  
  let cumulativeCount = 0;
  const totalPatterns = consecutiveLossData.length;
  for (const days of Object.keys(consecutiveCount).sort((a, b) => parseInt(a) - parseInt(b))) {
    cumulativeCount += consecutiveCount[days];
    const cumRate = (cumulativeCount / totalPatterns) * 100;
    console.log(`${days.padStart(6)}日  ${String(consecutiveCount[days]).padStart(6)}回  ${cumRate.toFixed(1).padStart(6)}%`);
  }

  // 連続損失ルールのバックテスト
  console.log('\n【連続損失ルールパフォーマンス】');
  
  const lossRuleTests = [
    { name: 'ルールなし', threshold: 999, reduction: 0 },
    { name: '3 日で 50% 削減', threshold: 3, reduction: 0.5 },
    { name: '3 日で 75% 削減', threshold: 3, reduction: 0.75 },
    { name: '5 日で 50% 削減', threshold: 5, reduction: 0.5 },
    { name: '5 日で完全撤退', threshold: 5, reduction: 1.0 },
  ];

  for (const rule of lossRuleTests) {
    let cumulative = 1;
    let currentConsecutive = 0;
    let activePosition = 1.0;
    
    for (let i = 0; i < baseResults.returns.length; i++) {
      const r = baseResults.returns[i];
      
      if (r.return < 0) {
        currentConsecutive++;
        if (currentConsecutive >= rule.threshold) {
          activePosition = 1.0 - rule.reduction;
        }
      } else {
        currentConsecutive = 0;
        activePosition = 1.0;
      }
      
      cumulative *= (1 + r.return * activePosition);
    }
    
    const totalRet = (cumulative - 1) * 100;
    console.log(`${rule.name.padEnd(15)}: 累積${totalRet.toFixed(2)}%`);
  }

  // ========================================================================
  // 3. ボラティリティ制御のテスト
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('3. ボラティリティ制御のテスト');
  console.log('='.repeat(80));

  // 米国市場のボラティリティ計算（ローリング 20 日）
  const volatilityWindow = 20;
  const usVolatility = [];
  
  for (let i = volatilityWindow; i < returnsUs.length; i++) {
    const window = returnsUs.slice(i - volatilityWindow, i).map(r => r.values);
    let totalVar = 0;
    let count = 0;
    
    for (const ret of window) {
      for (const r of ret) {
        totalVar += r * r;
        count++;
      }
    }
    
    const avgVar = totalVar / count;
    const vol = Math.sqrt(avgVar) * Math.sqrt(252);
    usVolatility.push({
      date: returnsUs[i].date,
      volatility: vol,
      index: i
    });
  }

  // ボラティリティ閾値（パーセンタイル）
  const volValues = usVolatility.map(v => v.volatility);
  const volSorted = [...volValues].sort((a, b) => a - b);
  const vol50 = volSorted[Math.floor(volSorted.length * 0.5)];
  const vol75 = volSorted[Math.floor(volSorted.length * 0.75)];
  const vol90 = volSorted[Math.floor(volSorted.length * 0.90)];

  console.log(`\nボラティリティ閾値：50%=${(vol50*100).toFixed(2)}%, 75%=${(vol75*100).toFixed(2)}%, 90%=${(vol90*100).toFixed(2)}%`);

  // ボラティリティ制御バックテスト
  console.log('\n【ボラティリティ制御パフォーマンス】');
  
  const volControlTests = [
    { name: '制御なし', threshold: 999, reduction: 0 },
    { name: '75% 超で 50% 削減', threshold: vol75, reduction: 0.5 },
    { name: '75% 超で 75% 削減', threshold: vol75, reduction: 0.75 },
    { name: '90% 超で 50% 削減', threshold: vol90, reduction: 0.5 },
    { name: '90% 超で完全撤退', threshold: vol90, reduction: 1.0 },
  ];

  for (const test of volControlTests) {
    let cumulative = 1;
    
    for (let i = 0; i < baseResults.returns.length; i++) {
      const r = baseResults.returns[i];
      const volIndex = usVolatility.findIndex(v => v.date === r.date);
      
      let positionSize = 1.0;
      if (volIndex >= 0) {
        const currentVol = usVolatility[volIndex].volatility;
        if (currentVol > test.threshold) {
          positionSize = 1.0 - test.reduction;
        }
      }
      
      cumulative *= (1 + r.return * positionSize);
    }
    
    const totalRet = (cumulative - 1) * 100;
    console.log(`${test.name.padEnd(15)}: 累積${totalRet.toFixed(2)}%`);
  }

  // ========================================================================
  // 4. 複合戦略の評価
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('4. 複合戦略の評価');
  console.log('='.repeat(80));

  // 季節性調整 + 連続損失ルール + ボラティリティ制御
  console.log('\n【複合戦略パフォーマンス】');
  
  let cumulativeCombined = 1;
  let consecutiveLossCount = 0;
  
  for (let i = 0; i < baseResults.returns.length; i++) {
    const r = baseResults.returns[i];
    const month = r.date.substring(5, 7);
    const volIndex = usVolatility.findIndex(v => v.date === r.date);
    
    // ベースポジションサイズ
    let positionSize = monthlyAdj[month]?.adjustment || 1.0;
    
    // 連続損失ルール
    if (r.return < 0) {
      consecutiveLossCount++;
      if (consecutiveLossCount >= 3) {
        positionSize *= 0.5;
      }
    } else {
      consecutiveLossCount = 0;
    }
    
    // ボラティリティ制御
    if (volIndex >= 0) {
      const currentVol = usVolatility[volIndex].volatility;
      if (currentVol > vol90) {
        positionSize *= 0.5;
      }
    }
    
    cumulativeCombined *= (1 + r.return * positionSize);
  }
  
  const totalRetCombined = (cumulativeCombined - 1) * 100;
  
  console.log(`ベースライン      : 累積${totalReturnBase.toFixed(2)}%`);
  console.log(`季節性調整のみ    : 累積${totalReturnAdj.toFixed(2)}%`);
  console.log(`複合戦略          : 累積${totalRetCombined.toFixed(2)}%`);
  console.log(`改善効果          : ${(totalRetCombined - totalReturnBase).toFixed(2)}%`);

  // ========================================================================
  // 5. 推奨事項
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('5. 推奨事項');
  console.log('='.repeat(80));

  console.log('\n【即時実装推奨】');
  console.log('1. 季節性調整：4-5 月・8 月・12 月はポジション 50% 削減');
  console.log('2. 連続損失ルール：3 日連続損失でポジション 50% 削減');
  console.log('3. ボラティリティ制御：90% パーセンタイル超でポジション 50% 削減');

  console.log('\n【期待効果】');
  console.log(`ベースライン累積：${totalReturnBase.toFixed(2)}%`);
  console.log(`複合戦略後累积：${totalRetCombined.toFixed(2)}%`);
  console.log(`総改善効果：${(totalRetCombined - totalReturnBase).toFixed(2)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('分析完了');
  console.log('='.repeat(80));
}

try {
  strategyEnhancement();
  process.exit(0);
} catch (err) {
  console.error('エラー:', err);
  console.error(err.stack);
  process.exit(1);
}
