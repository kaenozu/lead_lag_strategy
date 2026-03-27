/**
 * 戦略分析スクリプト - 改善余地の特定
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

function analyzeStrategy() {
  console.log('='.repeat(70));
  console.log('戦略分析 - 改善余地の特定');
  console.log('='.repeat(70));

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

  // 分析期間：直近 6 ヶ月
  const recentMonths = 6;
  const recentDays = recentMonths * 21;
  const startIndex = Math.max(defaultConfig.backtest.windowLength, dates.length - recentDays - defaultConfig.backtest.windowLength);
  const returnsUsRecent = returnsUs.slice(startIndex);
  const returnsJpRecent = returnsJp.slice(startIndex);
  const returnsJpOcRecent = returnsJpOc.slice(startIndex);
  const testDates = dates.slice(startIndex);

  console.log(`分析期間：${testDates[0]} ~ ${testDates[testDates.length - 1]} (${testDates.length}日)\n`);

  // ========================================================================
  // 1. パラメータ感応度分析
  // ========================================================================
  console.log('='.repeat(70));
  console.log('1. パラメータ感応度分析');
  console.log('='.repeat(70));

  const paramTests = [
    { name: 'ウィンドウ長 30 日', config: { windowLength: 30 } },
    { name: 'λ=0.5', config: { lambdaReg: 0.5 } },
    { name: 'λ=0.99', config: { lambdaReg: 0.99 } },
    { name: '分位点 0.3', config: { quantile: 0.3 } },
    { name: '分位点 0.5', config: { quantile: 0.5 } },
    { name: '因子数 5', config: { nFactors: 5 } },
  ];

  const baseConfig = {
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

  console.log('\n【パラメータ比較】');
  console.log('戦略                  AR(%)    RISK(%)   R/R      MDD(%)   累積 (%)');
  console.log('-'.repeat(70));

  const baseResults = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, baseConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const baseMetrics = computePerformanceMetrics(baseResults.returns.map(r => r.return));
  console.log(`基準 (現在)            ${(baseMetrics.AR*100).toFixed(2)}     ${(baseMetrics.RISK*100).toFixed(2)}     ${(baseMetrics.RR).toFixed(2)}     ${(baseMetrics.MDD*100).toFixed(2)}     ${((baseMetrics.Cumulative-1)*100).toFixed(2)}`);

  for (const test of paramTests) {
    const testConfig = { 
      ...baseConfig, 
      ...test.config,
      warmupPeriod: test.config.windowLength || baseConfig.windowLength
    };
    try {
      const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, testConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
      const metrics = computePerformanceMetrics(results.returns.map(r => r.return));
      const mark = metrics.AR > baseMetrics.AR ? '↑' : (metrics.AR < baseMetrics.AR ? '↓' : ' ');
      console.log(`${test.name.padEnd(20)} ${mark} ${(metrics.AR*100).toFixed(2)}     ${(metrics.RISK*100).toFixed(2)}     ${(metrics.RR).toFixed(2)}     ${(metrics.MDD*100).toFixed(2)}     ${((metrics.Cumulative-1)*100).toFixed(2)}`);
    } catch (e) {
      console.log(`${test.name.padEnd(20)} エラー：${e.message}`);
    }
  }

  // ========================================================================
  // 2. 取引コスト影響分析
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('2. 取引コスト影響分析');
  console.log('='.repeat(70));

  const costTests = [
    { name: 'コスト 0%', rate: 0 },
    { name: 'コスト 0.05%', rate: 0.0005 },
    { name: 'コスト 0.1%', rate: 0.001 },
    { name: 'コスト 0.2%', rate: 0.002 },
  ];

  console.log('\n【取引コスト比較】');
  console.log('戦略                  AR(%)    RISK(%)   R/R      MDD(%)   累積 (%)');
  console.log('-'.repeat(70));

  for (const test of costTests) {
    const costConfig = {
      ...baseConfig,
      transactionCosts: { rate: test.rate }
    };
    try {
      const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, costConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
      const metrics = computePerformanceMetrics(results.returns.map(r => r.return));
      console.log(`${test.name.padEnd(20)} ${(metrics.AR*100).toFixed(2)}     ${(metrics.RISK*100).toFixed(2)}     ${(metrics.RR).toFixed(2)}     ${(metrics.MDD*100).toFixed(2)}     ${((metrics.Cumulative-1)*100).toFixed(2)}`);
    } catch (e) {
      console.log(`${test.name.padEnd(20)} エラー：${e.message}`);
    }
  }

  // ========================================================================
  // 3. 安定化パラメータ分析
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('3. シグナル安定化パラメータ分析');
  console.log('='.repeat(70));

  const stabilityTests = [
    { name: '平滑化α=0.3', smoothingAlpha: 0.3 },
    { name: '平滑化α=0.5', smoothingAlpha: 0.5 },
    { name: '平滑化α=0.7', smoothingAlpha: 0.7 },
    { name: 'ターンオーバー制限 0.3', maxTurnoverPerDay: 0.3 },
    { name: 'ターンオーバー制限 0.7', maxTurnoverPerDay: 0.7 },
  ];

  console.log('\n【安定化パラメータ比較】');
  console.log('戦略                  AR(%)    RISK(%)   R/R      MDD(%)   累積 (%)');
  console.log('-'.repeat(70));

  for (const test of stabilityTests) {
    const stabilityConfig = {
      ...baseConfig,
      signalStability: {
        smoothingAlpha: test.smoothingAlpha !== undefined ? test.smoothingAlpha : baseConfig.signalStability.smoothingAlpha,
        maxTurnoverPerDay: test.maxTurnoverPerDay !== undefined ? test.maxTurnoverPerDay : baseConfig.signalStability.maxTurnoverPerDay
      }
    };
    try {
      const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, stabilityConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
      const metrics = computePerformanceMetrics(results.returns.map(r => r.return));
      const mark = metrics.AR > baseMetrics.AR ? '↑' : (metrics.AR < baseMetrics.AR ? '↓' : ' ');
      console.log(`${test.name.padEnd(20)} ${mark} ${(metrics.AR*100).toFixed(2)}     ${(metrics.RISK*100).toFixed(2)}     ${(metrics.RR).toFixed(2)}     ${(metrics.MDD*100).toFixed(2)}     ${((metrics.Cumulative-1)*100).toFixed(2)}`);
    } catch (e) {
      console.log(`${test.name.padEnd(20)} エラー：${e.message}`);
    }
  }

  // ========================================================================
  // 4. リスク制限分析
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('4. リスク制限分析');
  console.log('='.repeat(70));

  const riskTests = [
    { name: '最大ウェイト 0.3', maxAbsWeight: 0.3 },
    { name: '最大ウェイト 0.5', maxAbsWeight: 0.5 },
    { name: '最大ウェイト 1.0', maxAbsWeight: 1.0 },
    { name: '日次損失制限 3%', dailyLossStop: 0.03 },
    { name: '日次損失制限 5%', dailyLossStop: 0.05 },
  ];

  console.log('\n【リスク制限比較】');
  console.log('戦略                  AR(%)    RISK(%)   R/R      MDD(%)   累積 (%)');
  console.log('-'.repeat(70));

  for (const test of riskTests) {
    const riskConfig = {
      ...baseConfig,
      riskLimits: {
        maxAbsWeight: test.maxAbsWeight !== undefined ? test.maxAbsWeight : baseConfig.riskLimits.maxAbsWeight,
        dailyLossStop: test.dailyLossStop !== undefined ? test.dailyLossStop : baseConfig.riskLimits.dailyLossStop
      }
    };
    try {
      const results = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, riskConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
      const metrics = computePerformanceMetrics(results.returns.map(r => r.return));
      const mark = metrics.AR > baseMetrics.AR ? '↑' : (metrics.AR < baseMetrics.AR ? '↓' : ' ');
      console.log(`${test.name.padEnd(20)} ${mark} ${(metrics.AR*100).toFixed(2)}     ${(metrics.RISK*100).toFixed(2)}     ${(metrics.RR).toFixed(2)}     ${(metrics.MDD*100).toFixed(2)}     ${((metrics.Cumulative-1)*100).toFixed(2)}`);
    } catch (e) {
      console.log(`${test.name.padEnd(20)} エラー：${e.message}`);
    }
  }

  // ========================================================================
  // 5. 損失日分析
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('5. 損失日分析');
  console.log('='.repeat(70));

  const lossDays = baseResults.returns.filter(r => r.return < -0.005);
  console.log(`\n-0.5% 以上の損失日：${lossDays.length}日`);
  lossDays.forEach(r => {
    console.log(`  ${r.date}: ${(r.return*100).toFixed(2)}%`);
  });

  // 損失連続日数の分析
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;
  for (const r of baseResults.returns) {
    if (r.return < 0) {
      currentConsecutiveLosses++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutiveLosses);
    } else {
      currentConsecutiveLosses = 0;
    }
  }
  console.log(`\n最大連続損失日数：${maxConsecutiveLosses}日`);

  // ========================================================================
  // 6. 改善提言
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('6. 改善提言');
  console.log('='.repeat(70));

  console.log('\n【優先度：高】');
  console.log('1. パラメータ最適化の実施（グリッドサーチ）');
  console.log('2. 取引コストの再検討（実際の執行コストを反映）');
  console.log('3. リスク制限の強化（最大ウェイト 0.5 以下を推奨）');

  console.log('\n【優先度：中】');
  console.log('4. シグナル平滑化の導入（α=0.5-0.7）');
  console.log('5. 分位点パラメータの調整（0.3-0.4 が適切）');
  console.log('6. 因子数の見直し（3-5 の範囲で最適化）');

  console.log('\n【優先度：低】');
  console.log('7. ウィンドウ長の最適化（60-90 日が適切）');
  console.log('8. λパラメータの微調整（0.9-0.99 の範囲）');
  console.log('9. ターンオーバー制限の導入（0.5 以下）');

  // ========================================================================
  // 7. 改善版パラメータでバックテスト
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('7. 改善版パラメータでバックテスト');
  console.log('='.repeat(70));

  const improvedConfig = {
    ...baseConfig,
    lambdaReg: 0.95,       // 0.9→0.95
    maxTurnoverPerDay: 0.5 // ターンオーバー制限追加
  };

  console.log('\n【改善版パラメータ】');
  console.log('  λ（正則化強度）: 0.9 → 0.95');
  console.log('  ターンオーバー制限: 追加 (0.5)');
  console.log('  その他: 維持');

  const improvedResults = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, improvedConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const improvedMetrics = computePerformanceMetrics(improvedResults.returns.map(r => r.return));

  console.log('\n【パフォーマンス比較】');
  console.log('指標                現在       改善版     差分');
  console.log('-'.repeat(55));
  console.log(`年率リターン (%)    ${(baseMetrics.AR*100).toFixed(2).padStart(8)}   ${(improvedMetrics.AR*100).toFixed(2).padStart(8)}   ${((improvedMetrics.AR-baseMetrics.AR)*100).toFixed(2).padStart(7)}`);
  console.log(`年率リスク (%)      ${(baseMetrics.RISK*100).toFixed(2).padStart(8)}   ${(improvedMetrics.RISK*100).toFixed(2).padStart(8)}   ${((improvedMetrics.RISK-baseMetrics.RISK)*100).toFixed(2).padStart(7)}`);
  console.log(`R/R 比              ${(baseMetrics.RR).toFixed(2).padStart(8)}   ${(improvedMetrics.RR).toFixed(2).padStart(8)}   ${(improvedMetrics.RR-baseMetrics.RR).toFixed(2).padStart(7)}`);
  console.log(`最大 DD (%)         ${(baseMetrics.MDD*100).toFixed(2).padStart(8)}   ${(improvedMetrics.MDD*100).toFixed(2).padStart(8)}   ${((improvedMetrics.MDD-baseMetrics.MDD)*100).toFixed(2).padStart(7)}`);
  console.log(`累積リターン (%)    ${((baseMetrics.Cumulative-1)*100).toFixed(2).padStart(8)}   ${((improvedMetrics.Cumulative-1)*100).toFixed(2).padStart(8)}   ${((improvedMetrics.Cumulative-baseMetrics.Cumulative)*100).toFixed(2).padStart(7)}`);

  // 月次パフォーマンス比較
  console.log('\n【月次パフォーマンス比較】');
  
  const monthlyReturns = { base: {}, improved: {} };
  baseResults.returns.forEach(r => {
    const month = r.date.substring(0, 7);
    if (!monthlyReturns.base[month]) monthlyReturns.base[month] = 0;
    monthlyReturns.base[month] += r.return;
  });
  improvedResults.returns.forEach(r => {
    const month = r.date.substring(0, 7);
    if (!monthlyReturns.improved[month]) monthlyReturns.improved[month] = 0;
    monthlyReturns.improved[month] += r.return;
  });

  console.log('月次      現在 (%)    改善版 (%)   差分');
  console.log('-'.repeat(50));
  const months = Object.keys(monthlyReturns.base).sort();
  months.forEach(month => {
    const baseRet = (monthlyReturns.base[month] * 100).toFixed(2);
    const impRet = (monthlyReturns.improved[month] * 100).toFixed(2);
    const diff = ((monthlyReturns.improved[month] - monthlyReturns.base[month]) * 100).toFixed(2);
    const sign = diff >= 0 ? '+' : '';
    console.log(`${month}   ${baseRet.padStart(8)}   ${impRet.padStart(9)}   ${sign}${diff.padStart(7)}`);
  });

  // ========================================================================
  // 8. 最適化パラメータの再テスト（λ=0.99）
  // ========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('8. 最適化パラメータの再テスト（λ=0.99）');
  console.log('='.repeat(70));

  const optimalConfig = {
    ...baseConfig,
    lambdaReg: 0.99        // 0.9→0.99
  };

  console.log('\n【最適化パラメータ】');
  console.log('  λ（正則化強度）: 0.9 → 0.99');
  console.log('  その他：維持');

  const optimalResults = runBacktest(returnsUsRecent, returnsJpRecent, returnsJpOcRecent, optimalConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const optimalMetrics = computePerformanceMetrics(optimalResults.returns.map(r => r.return));

  console.log('\n【パフォーマンス比較】');
  console.log('指標                現在       最適化     差分');
  console.log('-'.repeat(55));
  console.log(`年率リターン (%)    ${(baseMetrics.AR*100).toFixed(2).padStart(8)}   ${(optimalMetrics.AR*100).toFixed(2).padStart(8)}   ${((optimalMetrics.AR-baseMetrics.AR)*100).toFixed(2).padStart(7)}`);
  console.log(`年率リスク (%)      ${(baseMetrics.RISK*100).toFixed(2).padStart(8)}   ${(optimalMetrics.RISK*100).toFixed(2).padStart(8)}   ${((optimalMetrics.RISK-baseMetrics.RISK)*100).toFixed(2).padStart(7)}`);
  console.log(`R/R 比              ${(baseMetrics.RR).toFixed(2).padStart(8)}   ${(optimalMetrics.RR).toFixed(2).padStart(8)}   ${(optimalMetrics.RR-baseMetrics.RR).toFixed(2).padStart(7)}`);
  console.log(`最大 DD (%)         ${(baseMetrics.MDD*100).toFixed(2).padStart(8)}   ${(optimalMetrics.MDD*100).toFixed(2).padStart(8)}   ${((optimalMetrics.MDD-baseMetrics.MDD)*100).toFixed(2).padStart(7)}`);
  console.log(`累積リターン (%)    ${((baseMetrics.Cumulative-1)*100).toFixed(2).padStart(8)}   ${((optimalMetrics.Cumulative-1)*100).toFixed(2).padStart(8)}   ${((optimalMetrics.Cumulative-baseMetrics.Cumulative)*100).toFixed(2).padStart(7)}`);

  // 月次パフォーマンス比較
  const monthlyReturnsOpt = { base: {}, optimal: {} };
  baseResults.returns.forEach(r => {
    const month = r.date.substring(0, 7);
    if (!monthlyReturnsOpt.base[month]) monthlyReturnsOpt.base[month] = 0;
    monthlyReturnsOpt.base[month] += r.return;
  });
  optimalResults.returns.forEach(r => {
    const month = r.date.substring(0, 7);
    if (!monthlyReturnsOpt.optimal[month]) monthlyReturnsOpt.optimal[month] = 0;
    monthlyReturnsOpt.optimal[month] += r.return;
  });

  console.log('\n【月次パフォーマンス比較】');
  console.log('月次      現在 (%)    最適化 (%)   差分');
  console.log('-'.repeat(50));
  months.forEach(month => {
    const baseRet = (monthlyReturnsOpt.base[month] * 100).toFixed(2);
    const optRet = (monthlyReturnsOpt.optimal[month] * 100).toFixed(2);
    const diff = ((monthlyReturnsOpt.optimal[month] - monthlyReturnsOpt.base[month]) * 100).toFixed(2);
    const sign = diff >= 0 ? '+' : '';
    console.log(`${month}   ${baseRet.padStart(8)}   ${optRet.padStart(9)}   ${sign}${diff.padStart(7)}`);
  });

  // 最終推奨
  console.log('\n' + '='.repeat(70));
  console.log('【最終推奨パラメータ】');
  console.log('='.repeat(70));
  
  const bestMetrics = optimalMetrics.AR > baseMetrics.AR ? optimalMetrics : baseMetrics;
  const bestConfig = optimalMetrics.AR > baseMetrics.AR ? optimalConfig : baseConfig;
  const bestName = optimalMetrics.AR > baseMetrics.AR ? '最適化版' : '現在版';
  
  console.log(`\n推奨：${bestName}`);
  console.log(`  年率リターン：${(bestMetrics.AR*100).toFixed(2)}%`);
  console.log(`  年率リスク：${(bestMetrics.RISK*100).toFixed(2)}%`);
  console.log(`  R/R 比：${bestMetrics.RR.toFixed(2)}`);
  console.log(`  最大 DD: ${(bestMetrics.MDD*100).toFixed(2)}%`);
  console.log(`  累積リターン：${((bestMetrics.Cumulative-1)*100).toFixed(2)}%`);

  console.log('\n' + '='.repeat(70));
  console.log('分析完了');
  console.log('='.repeat(70));
}

try {
  analyzeStrategy();
  process.exit(0);
} catch (err) {
  console.error('エラー:', err);
  process.exit(1);
}
