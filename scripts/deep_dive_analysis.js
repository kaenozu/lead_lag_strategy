/**
 * 戦略深堀り分析
 * - パラメータグリッドサーチ
 * - 市場環境別分析
 * - セクター別貢献度
 * - 損失パターン分析
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

function deepDiveAnalysis() {
  console.log('='.repeat(80));
  console.log('戦略深堀り分析');
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

  // ========================================================================
  // 1. パラメータグリッドサーチ
  // ========================================================================
  console.log('='.repeat(80));
  console.log('1. パラメータグリッドサーチ（λ×分位点）');
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
        const results = runBacktest(returnsUs, returnsJp, returnsJpOc, config, SECTOR_LABELS, CFull, 'PCA_SUB');
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
  const bestByMDD = validResults.reduce((min, r) => r.MDD > min.MDD ? r : min, validResults[0]); // MDD は負の値なので大きい方が良い

  console.log('\n【最佳パラメータ】');
  console.log(`最高 AR:  λ=${bestByAR.lambda}, Q=${bestByAR.quantile}, AR=${bestByAR.AR.toFixed(2)}%, R/R=${bestByAR.RR.toFixed(2)}`);
  console.log(`最高 R/R: λ=${bestByRR.lambda}, Q=${bestByRR.quantile}, AR=${bestByRR.AR.toFixed(2)}%, R/R=${bestByRR.RR.toFixed(2)}`);
  console.log(`最小 MDD: λ=${bestByMDD.lambda}, Q=${bestByMDD.quantile}, MDD=${bestByMDD.MDD.toFixed(2)}%, AR=${bestByMDD.AR.toFixed(2)}%`);

  // ========================================================================
  // 2. 市場環境別分析
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('2. 市場環境別分析');
  console.log('='.repeat(80));

  // 米国市場のボラティリティで環境分類
  const windowLength = 60;
  const usVolatility = [];
  
  for (let i = windowLength; i < returnsUs.length; i++) {
    const window = returnsUs.slice(i - windowLength, i).map(r => r.values);
    // 米国 ETF の平均ボラティリティを計算
    let totalVar = 0;
    for (const ret of window) {
      for (const r of ret) {
        totalVar += r * r;
      }
    }
    const avgVar = totalVar / (window.length * window[0].length);
    usVolatility.push({
      date: returnsUs[i].date,
      volatility: Math.sqrt(avgVar) * Math.sqrt(252),
      index: i
    });
  }

  // ボラティリティで高・中・低に分類
  const volValues = usVolatility.map(v => v.volatility);
  const volSorted = [...volValues].sort((a, b) => a - b);
  const volLowThreshold = volSorted[Math.floor(volSorted.length * 0.33)];
  const volHighThreshold = volSorted[Math.floor(volSorted.length * 0.67)];

  const regimes = {
    low: { name: '低ボラティリティ', count: 0, returns: [] },
    medium: { name: '中ボラティリティ', count: 0, returns: [] },
    high: { name: '高ボラティリティ', count: 0, returns: [] }
  };

  for (const v of usVolatility) {
    let regime;
    if (v.volatility < volLowThreshold) regime = 'low';
    else if (v.volatility < volHighThreshold) regime = 'medium';
    else regime = 'high';

    regimes[regime].count++;
    if (v.index < returnsJpOc.length) {
      const ret = returnsJpOc[v.index].values;
      regimes[regime].returns.push(ret);
    }
  }

  console.log('\n【市場環境別パフォーマンス】');
  console.log(`ボラティリティ閾値：低<${(volLowThreshold*100).toFixed(2)}%, 中<${(volHighThreshold*100).toFixed(2)}%, 高`);
  console.log('-'.repeat(60));
  
  for (const [key, regime] of Object.entries(regimes)) {
    const allReturns = regime.returns.flat();
    const avgRet = allReturns.reduce((a, b) => a + b, 0) / allReturns.length * 252 * 100;
    const stdRet = Math.sqrt(allReturns.reduce((a, b) => a + Math.pow(b - allReturns.reduce((x, y) => x + y, 0) / allReturns.length, 2), 0) / allReturns.length) * Math.sqrt(252) * 100;
    console.log(`${regime.name.padEnd(12)}: ${regime.count}日, 年率リターン=${avgRet.toFixed(2)}%, リスク=${stdRet.toFixed(2)}%`);
  }

  // ========================================================================
  // 3. セクター別貢献度分析
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('3. セクター別貢献度分析（直近 3 ヶ月）');
  console.log('='.repeat(80));

  const recentStart = dates.length - 63;
  const recentEnd = dates.length;
  
  const sectorContribution = {};
  
  // セクターラベルを逆引き
  const jpSectors = {};
  for (const [key, label] of Object.entries(SECTOR_LABELS)) {
    if (key.startsWith('JP_')) {
      const ticker = key.replace('JP_', '');
      jpSectors[ticker] = label;
    }
  }

  for (let i = recentStart; i < recentEnd; i++) {
    const config = {
      windowLength: 60,
      nFactors: 3,
      lambdaReg: 0.99,
      quantile: 0.4,
      warmupPeriod: 60
    };
    
    const windowStart = i - 60;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJp.slice(windowStart, i).map(r => r.values);
    const retUsLatest = returnsUs[i - 1].values;

    // シグナル計算（簡易版）
    // 実際の LeadLagSignal を使用
    const { LeadLagSignal } = require('../lib/pca');
    const signalGenerator = new LeadLagSignal(config);
    
    try {
      const signal = signalGenerator.computeSignal(retUsWindow, retJpWindow, retUsLatest, SECTOR_LABELS, CFull);
      const weights = buildPortfolio(signal, 0.4);
      const retNext = returnsJpOc[i].values;

      // セクター別貢献度
      const jpTickers = Object.keys(JP_ETF_TICKERS);
      for (let j = 0; j < jpTickers.length; j++) {
        const ticker = jpTickers[j];
        const sector = jpSectors[ticker] || 'neutral';
        if (!sectorContribution[sector]) {
          sectorContribution[sector] = { total: 0, count: 0, positive: 0, negative: 0 };
        }
        const contrib = weights[j] * retNext[j];
        sectorContribution[sector].total += contrib;
        sectorContribution[sector].count++;
        if (contrib > 0) sectorContribution[sector].positive++;
        else if (contrib < 0) sectorContribution[sector].negative++;
      }
    } catch (e) {
      // エラーは無視
    }
  }

  console.log('\n【セクター別貢献度（直近 3 ヶ月）】');
  console.log('-'.repeat(60));
  console.log('セクター         総貢献度 (bp)  勝率 (%)  日数');
  console.log('-'.repeat(60));
  
  for (const [sector, data] of Object.entries(sectorContribution)) {
    const contribBp = data.total * 10000;
    const winRate = data.count > 0 ? (data.positive / data.count) * 100 : 0;
    console.log(`${sector.padEnd(15)} ${contribBp.toFixed(2).padStart(12)}  ${winRate.toFixed(1).padStart(6)}  ${data.count}`);
  }

  // ========================================================================
  // 4. 損失パターン深堀り
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('4. 損失パターン深堀り分析');
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

  const results = runBacktest(returnsUs, returnsJp, returnsJpOc, baseConfig, SECTOR_LABELS, CFull, 'PCA_SUB');
  const returns = results.returns;

  // 損失日の分類
  const lossDays = returns.filter(r => r.return < -0.003);
  const bigLossDays = returns.filter(r => r.return < -0.01);
  const smallLossDays = returns.filter(r => r.return >= -0.01 && r.return < -0.003);

  console.log('\n【損失日分類】');
  console.log(`総損失日数：${returns.filter(r => r.return < 0).length}日`);
  console.log(`-1% 以上の損失：${bigLossDays.length}日`);
  console.log(`-0.3%〜-1% の損失：${smallLossDays.length}日`);
  console.log(`-0.3% 未満の損失：${returns.filter(r => r.return >= -0.003 && r.return < 0).length}日`);

  // 損失連続パターン
  console.log('\n【損失連続パターン】');
  let consecutive = 0;
  const consecutiveLosses = [];
  
  for (const r of returns) {
    if (r.return < 0) {
      consecutive++;
    } else {
      if (consecutive > 0) {
        consecutiveLosses.push(consecutive);
      }
      consecutive = 0;
    }
  }
  if (consecutive > 0) consecutiveLosses.push(consecutive);

  const consecutiveCount = {};
  for (const c of consecutiveLosses) {
    consecutiveCount[c] = (consecutiveCount[c] || 0) + 1;
  }

  console.log('連続損失日数  発生回数');
  console.log('-'.repeat(30));
  for (const [days, count] of Object.entries(consecutiveCount).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log(`${days.padStart(8)}日  ${count}回`);
  }

  // 損失日の米国市場分析
  console.log('\n【損失日の米国市場状況】');
  const lossDayUSReturns = [];
  const gainDayUSReturns = [];

  for (let i = baseConfig.warmupPeriod; i < returns.length; i++) {
    const retJP = returns[i].return;
    const retUS = returnsUs[i - 1].values.reduce((a, b) => a + b, 0) / returnsUs[i - 1].values.length;
    
    if (retJP < -0.003) {
      lossDayUSReturns.push(retUS);
    } else if (retJP > 0.003) {
      gainDayUSReturns.push(retUS);
    }
  }

  const avgUSOnLoss = lossDayUSReturns.reduce((a, b) => a + b, 0) / lossDayUSReturns.length * 100;
  const avgUSOnGain = gainDayUSReturns.reduce((a, b) => a + b, 0) / gainDayUSReturns.length * 100;
  
  console.log(`損失日の米国平均リターン：${avgUSOnLoss.toFixed(2)}%`);
  console.log(`収益日の米国平均リターン：${avgUSOnGain.toFixed(2)}%`);
  console.log(`差分：${(avgUSOnGain - avgUSOnLoss).toFixed(2)}%`);

  // ========================================================================
  // 5. 月次パターン分析
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('5. 月次パターン分析');
  console.log('='.repeat(80));

  const monthlyData = {};
  for (const r of returns) {
    const month = r.date.substring(5, 7); // MM
    if (!monthlyData[month]) {
      monthlyData[month] = { returns: [], count: 0 };
    }
    monthlyData[month].returns.push(r.return);
    monthlyData[month].count++;
  }

  const monthNames = {
    '01': '1 月', '02': '2 月', '03': '3 月', '04': '4 月',
    '05': '5 月', '06': '6 月', '07': '7 月', '08': '8 月',
    '09': '9 月', '10': '10 月', '11': '11 月', '12': '12 月'
  };

  console.log('\n【月次パフォーマンス（年率換算）】');
  console.log('-'.repeat(50));
  console.log('月份    平均リターン (%)  勝率 (%)  日数');
  console.log('-'.repeat(50));

  for (const [month, data] of Object.entries(monthlyData).sort()) {
    const avgRet = data.returns.reduce((a, b) => a + b, 0) / data.returns.length * 252 * 100;
    const winRate = data.returns.filter(r => r > 0).length / data.returns.length * 100;
    console.log(`${monthNames[month].padEnd(6)} ${avgRet.toFixed(2).padStart(12)}  ${winRate.toFixed(1).padStart(7)}  ${data.count}`);
  }

  // ========================================================================
  // 6. 推奨アクション
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('6. 推奨アクション');
  console.log('='.repeat(80));

  console.log('\n【パラメータ推奨】');
  console.log(`λ（正則化強度）: ${bestByRR.lambda}（R/R 最大化）`);
  console.log(`分位点：${bestByRR.quantile}`);
  console.log(`期待 R/R 比：${bestByRR.RR.toFixed(2)}`);

  console.log('\n【リスク管理推奨】');
  console.log(`最大連続損失日数：${Math.max(...consecutiveLosses)}日`);
  console.log(`推奨ストップロス：${Math.abs(parseFloat(Math.min(...returns.map(r => r.return)).toFixed(4))) * 100}%`);

  console.log('\n【市場環境対応】');
  console.log('高ボラティリティ環境でのポジション削減を検討');
  console.log(`高ボラティリティ日数：${regimes.high.count}日（全期間の${(regimes.high.count / usVolatility.length * 100).toFixed(1)}%）`);

  console.log('\n' + '='.repeat(80));
  console.log('分析完了');
  console.log('='.repeat(80));
}

// ポートフォリオ構築関数
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

try {
  deepDiveAnalysis();
  process.exit(0);
} catch (err) {
  console.error('エラー:', err);
  console.error(err.stack);
  process.exit(1);
}
