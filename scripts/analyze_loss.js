/**
 * 損失原因分析スクリプト
 * 過去 1 ヶ月のパフォーマンスを詳細に分析
 * 
 * Usage: node scripts/analyze_loss.js
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
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES, SECTOR_LABELS } = require('../lib/constants');
const { createLogger } = require('../lib/logger');

const logger = createLogger('LossAnalyzer');

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🔍 損失原因分析レポート');
  console.log('='.repeat(80));
  
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  
  console.log(`\n📅 分析期間：${oneMonthAgo.toISOString().split('T')[0]} ~ ${today.toISOString().split('T')[0]}`);
  
  // データ取得
  const winDays = config.backtest.windowLength + 80;
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
  
  // 相関行列計算
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  
  // シグナル生成器
  const signalGen = new LeadLagSignal({
    lambdaReg: config.backtest.lambdaReg,
    nFactors: config.backtest.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });
  
  // 過去 1 ヶ月の営業日を特定
  const endDate = retUs.length - 1;
  const startDate = Math.max(0, endDate - 30);
  
  // 分析データ収集
  const dailyAnalysis = [];
  const sectorPerformance = {};
  const usJpCorrelation = [];
  const signalQuality = [];
  
  // 各セクターの初期化
  JP_ETF_TICKERS.forEach(ticker => {
    sectorPerformance[ticker] = {
      ticker,
      name: JP_ETF_NAMES[ticker],
      sector: SECTOR_LABELS[`JP_${ticker}`],
      longCount: 0,
      shortCount: 0,
      avgReturnWhenLong: 0,
      avgReturnWhenShort: 0,
      totalReturnWhenLong: 0,
      totalReturnWhenShort: 0,
      winRateWhenLong: 0,
      winRateWhenShort: 0,
      longWins: 0,
      shortWins: 0,
      longLosses: 0,
      shortLosses: 0
    };
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 日次分析中...');
  console.log('='.repeat(80));
  
  for (let i = startDate; i <= endDate; i++) {
    // ウィンドウデータ
    const windowStart = Math.max(0, i - config.backtest.windowLength);
    const retUsWindow = retUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = retJp.slice(windowStart, i).map(r => r.values);
    const retUsLatest = retUs[i - 1].values;
    
    // シグナル計算
    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      config.sectorLabels,
      CFull
    );
    
    // ランキング作成
    const signals = JP_ETF_TICKERS.map((ticker, idx) => ({
      ticker,
      name: JP_ETF_NAMES[ticker],
      signal: signal[idx],
      signalRank: 0,
      actualReturn: retJpOc[i].values[idx]
    })).sort((a, b) => b.signal - a.signal);
    
    // ランク付与
    signals.forEach((s, idx) => {
      s.signalRank = idx + 1;
    });
    
    // 買い銘柄選択
    const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * config.backtest.quantile));
    const buyCandidates = signals.slice(0, buyCount);
    const shortCandidates = signals.slice(-buyCount);
    
    // ポートフォリオ構築
    const weights = new Array(JP_ETF_TICKERS.length).fill(0);
    const weightPerStock = 1.0 / buyCount;
    
    buyCandidates.forEach(c => {
      const idx = JP_ETF_TICKERS.indexOf(c.ticker);
      weights[idx] = weightPerStock;
    });
    
    shortCandidates.forEach(c => {
      const idx = JP_ETF_TICKERS.indexOf(c.ticker);
      weights[idx] = -weightPerStock;
    });
    
    // 損益計算
    const retOc = retJpOc[i].values;
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      if (weights[j] !== 0) {
        portfolioReturn += weights[j] * retOc[j];
      }
    }
    
    // 米国リターンの影響
    const usReturnDay = retUs[i] ? retUs[i].values.reduce((a, b) => a + b, 0) / US_ETF_TICKERS.length : 0;
    
    // 予測精度分析
    const longActualReturns = buyCandidates.map(c => c.actualReturn);
    const shortActualReturns = shortCandidates.map(c => c.actualReturn);
    const avgLongReturn = longActualReturns.reduce((a, b) => a + b, 0) / longActualReturns.length;
    const avgShortReturn = shortActualReturns.reduce((a, b) => a + b, 0) / shortActualReturns.length;
    const predictionAccuracy = (avgLongReturn - avgShortReturn) > 0 ? 1 : 0;
    
    // セクター別パフォーマンス更新
    buyCandidates.forEach(c => {
      const sp = sectorPerformance[c.ticker];
      sp.longCount++;
      sp.totalReturnWhenLong += c.actualReturn;
      sp.avgReturnWhenLong = sp.totalReturnWhenLong / sp.longCount;
      if (c.actualReturn > 0) {
        sp.longWins++;
        sp.winRateWhenLong = sp.longWins / sp.longCount;
      } else {
        sp.longLosses++;
      }
    });
    
    shortCandidates.forEach(c => {
      const sp = sectorPerformance[c.ticker];
      sp.shortCount++;
      sp.totalReturnWhenShort += c.actualReturn;
      sp.avgReturnWhenShort = sp.totalReturnWhenShort / sp.shortCount;
      if (c.actualReturn < 0) {
        sp.shortWins++;
        sp.winRateWhenShort = sp.shortWins / sp.shortCount;
      } else {
        sp.shortLosses++;
      }
    });
    
    dailyAnalysis.push({
      date: retJpOc[i].date,
      portfolioReturn,
      usReturn: usReturnDay,
      avgLongReturn,
      avgShortReturn,
      predictionAccuracy,
      longPositions: buyCandidates.map(c => c.ticker),
      shortPositions: shortCandidates.map(c => c.ticker),
      signals: signals.map(s => ({
        ticker: s.ticker,
        signalRank: s.signalRank,
        actualReturn: s.actualReturn
      }))
    });
    
    usJpCorrelation.push({
      date: retJpOc[i].date,
      usReturn: usReturnDay,
      jpAverageReturn: retJpOc[i].values.reduce((a, b) => a + b, 0) / JP_ETF_TICKERS.length
    });
    
    signalQuality.push({
      date: retJpOc[i].date,
      avgLongReturn,
      avgShortReturn,
      predictionAccuracy,
      portfolioReturn
    });
  }
  
  // ========================================
  // 分析結果表示
  // ========================================
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 1. 予測精度分析');
  console.log('='.repeat(80));
  
  const accurateDays = signalQuality.filter(sq => sq.predictionAccuracy === 1);
  const inaccurateDays = signalQuality.filter(sq => sq.predictionAccuracy === 0);
  
  console.log(`\n予測が当たった日：${accurateDays.length}日 (${(accurateDays.length / signalQuality.length * 100).toFixed(1)}%)`);
  console.log(`予測が外れた日：${inaccurateDays.length}日 (${(inaccurateDays.length / signalQuality.length * 100).toFixed(1)}%)`);
  
  const avgReturnWhenAccurate = accurateDays.reduce((sum, d) => sum + d.portfolioReturn, 0) / accurateDays.length;
  const avgReturnWhenInaccurate = inaccurateDays.reduce((sum, d) => sum + d.portfolioReturn, 0) / inaccurateDays.length;
  
  console.log(`\n予測成功時の平均リターン：${(avgReturnWhenAccurate * 100).toFixed(2)}%`);
  console.log(`予測失敗時の平均リターン：${(avgReturnWhenInaccurate * 100).toFixed(2)}%`);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 2. 米国市場との相関分析');
  console.log('='.repeat(80));
  
  const usReturns = usJpCorrelation.map(d => d.usReturn);
  const jpReturns = usJpCorrelation.map(d => d.jpAverageReturn);
  
  // 相関係数計算
  const usMean = usReturns.reduce((a, b) => a + b, 0) / usReturns.length;
  const jpMean = jpReturns.reduce((a, b) => a + b, 0) / jpReturns.length;
  
  let numerator = 0;
  let usVar = 0;
  let jpVar = 0;
  
  for (let i = 0; i < usReturns.length; i++) {
    const usDiff = usReturns[i] - usMean;
    const jpDiff = jpReturns[i] - jpMean;
    numerator += usDiff * jpDiff;
    usVar += usDiff * usDiff;
    jpVar += jpDiff * jpDiff;
  }
  
  const correlation = numerator / Math.sqrt(usVar * jpVar);
  
  console.log(`\n米国 ETF 平均リターンと日本 ETF 平均リターンの相関係数：${correlation.toFixed(3)}`);
  
  // 米国リターンと戦略リターンの相関
  const strategyReturns = dailyAnalysis.map(d => d.portfolioReturn);
  const strategyMean = strategyReturns.reduce((a, b) => a + b, 0) / strategyReturns.length;
  
  numerator = 0;
  usVar = 0;
  let stratVar = 0;
  
  for (let i = 0; i < usReturns.length; i++) {
    const usDiff = usReturns[i] - usMean;
    const stratDiff = strategyReturns[i] - strategyMean;
    numerator += usDiff * stratDiff;
    usVar += usDiff * usDiff;
    stratVar += stratDiff * stratDiff;
  }
  
  const usStrategyCorrelation = numerator / Math.sqrt(usVar * stratVar);
  console.log(`米国 ETF リターンと戦略リターンの相関係数：${usStrategyCorrelation.toFixed(3)}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 3. セクター別パフォーマンス（ロング）');
  console.log('='.repeat(80));
  
  const longPerformance = Object.values(sectorPerformance)
    .filter(s => s.longCount > 0)
    .sort((a, b) => b.avgReturnWhenLong - a.avgReturnWhenLong);
  
  console.log('\n銘柄      業種         ロング回数  平均リターン (%)  勝率 (%)');
  console.log('-'.repeat(80));
  
  longPerformance.forEach(s => {
    const sectorName = s.sector || 'neutral';
    console.log(
      `${s.ticker.padEnd(8)} ${s.name.padEnd(12)} ${String(s.longCount).padStart(6)}回  ` +
      `${(s.avgReturnWhenLong * 100).toFixed(2).padStart(8)}  ${(s.winRateWhenLong * 100).toFixed(1).padStart(6)}`
    );
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 4. セクター別パフォーマンス（ショート）');
  console.log('='.repeat(80));
  
  const shortPerformance = Object.values(sectorPerformance)
    .filter(s => s.shortCount > 0)
    .sort((a, b) => a.avgReturnWhenShort - b.avgReturnWhenShort); // ショートなので上昇が損失
  
  console.log('\n銘柄      業種         ショート回数  平均リターン (%)  勝率 (%)');
  console.log('-'.repeat(80));
  
  shortPerformance.forEach(s => {
    const sectorName = s.sector || 'neutral';
    // ショートなので、リターンが負なら勝ち
    const winRate = s.shortCount > 0 ? (s.shortWins / s.shortCount * 100) : 0;
    console.log(
      `${s.ticker.padEnd(8)} ${s.name.padEnd(12)} ${String(s.shortCount).padStart(6)}回  ` +
      `${(s.avgReturnWhenShort * 100).toFixed(2).padStart(8)}  ${winRate.toFixed(1).padStart(6)}`
    );
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 5. 損失日の分析');
  console.log('='.repeat(80));
  
  const losingDays = dailyAnalysis.filter(d => d.portfolioReturn < 0);
  const winningDays = dailyAnalysis.filter(d => d.portfolioReturn > 0);
  
  console.log(`\n損失日数：${losingDays.length}日`);
  console.log(`勝利日数：${winningDays.length}日`);
  
  // 大きな損失日
  const bigLossDays = losingDays
    .sort((a, b) => a.portfolioReturn - b.portfolioReturn)
    .slice(0, 5);
  
  console.log('\n🔴 大きな損失日 TOP5');
  console.log('日付         リターン (%)  米国リターン (%)  ロング上位                    ショート下位');
  console.log('-'.repeat(80));
  
  bigLossDays.forEach(d => {
    const longStr = d.longPositions.slice(0, 3).join(', ').replace(/\.T/g, '');
    const shortStr = d.shortPositions.slice(0, 3).join(', ').replace(/\.T/g, '');
    console.log(
      `${d.date}  ${(d.portfolioReturn * 100).toFixed(2).padStart(7)}  ` +
      `${(d.usReturn * 100).toFixed(2).padStart(7)}  ` +
      `L: ${longStr.padEnd(20)} S: ${shortStr}`
    );
  });
  
  // 大きな勝利日
  const bigWinDays = winningDays
    .sort((a, b) => b.portfolioReturn - a.portfolioReturn)
    .slice(0, 5);
  
  console.log('\n🟢 大きな勝利日 TOP5');
  console.log('日付         リターン (%)  米国リターン (%)  ロング上位                    ショート下位');
  console.log('-'.repeat(80));
  
  bigWinDays.forEach(d => {
    const longStr = d.longPositions.slice(0, 3).join(', ').replace(/\.T/g, '');
    const shortStr = d.shortPositions.slice(0, 3).join(', ').replace(/\.T/g, '');
    console.log(
      `${d.date}  ${(d.portfolioReturn * 100).toFixed(2).padStart(7)}  ` +
      `${(d.usReturn * 100).toFixed(2).padStart(7)}  ` +
      `L: ${longStr.padEnd(20)} S: ${shortStr}`
    );
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 6. シグナルランキング vs 実際のリターン');
  console.log('='.repeat(80));
  
  // 全日の平均を実際のリターンで計算
  const avgActualReturnByRank = new Array(18).fill(0);
  const countByRank = new Array(18).fill(0);
  
  dailyAnalysis.forEach(d => {
    d.signals.forEach((s, idx) => {
      const rank = s.signalRank;
      if (rank <= 17) {
        avgActualReturnByRank[rank] += s.actualReturn;
        countByRank[rank]++;
      }
    });
  });
  
  console.log('\nシグナルランク  平均実際リターン (%)  観測数');
  console.log('-'.repeat(80));
  
  for (let i = 1; i <= 17; i++) {
    const avg = countByRank[i] > 0 ? avgActualReturnByRank[i] / countByRank[i] : 0;
    const label = i <= 6 ? 'ロング' : i >= 12 ? 'ショート' : '中立';
    console.log(
      `${String(i).padStart(6)} (${label.padEnd(6)})  ${(avg * 100).toFixed(2).padStart(10)}  ${String(countByRank[i]).padStart(6)}`
    );
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🔍 7. 損失原因の特定');
  console.log('='.repeat(80));
  
  // 原因分析
  const causes = [];
  
  // 1. 予測精度
  const predictionAccuracyRate = accurateDays.length / signalQuality.length * 100;
  if (predictionAccuracyRate < 50) {
    causes.push({
      cause: '予測精度の低さ',
      description: `予測成功率${predictionAccuracyRate.toFixed(1)}%はランダム以下`,
      impact: '大'
    });
  }
  
  // 2. 米国との相関
  if (Math.abs(usStrategyCorrelation) < 0.3) {
    causes.push({
      cause: '米国市場との相関不足',
      description: `相関係数${usStrategyCorrelation.toFixed(3)}は低すぎる`,
      impact: '中'
    });
  }
  
  // 3. ショートパフォーマンス
  const avgShortWinRate = Object.values(sectorPerformance)
    .filter(s => s.shortCount > 0)
    .reduce((sum, s) => sum + (s.shortWins / s.shortCount), 0) / 17;
  
  if (avgShortWinRate < 0.4) {
    causes.push({
      cause: 'ショート戦略の不調',
      description: `平均勝率${(avgShortWinRate * 100).toFixed(1)}%`,
      impact: '大'
    });
  }
  
  // 4. 特定セクターの不振
  const worstLongSectors = longPerformance.slice(-5);
  const avgWorstLongReturn = worstLongSectors.reduce((sum, s) => sum + s.avgReturnWhenLong, 0) / worstLongSectors.length;
  
  if (avgWorstLongReturn < -0.001) {
    causes.push({
      cause: '特定セクターの継続的損失',
      description: `下位 5 銘柄の平均リターン${(avgWorstLongReturn * 100).toFixed(2)}%`,
      impact: '中'
    });
  }
  
  // 5. 大きな損失日の存在
  const avgBigLoss = bigLossDays.reduce((sum, d) => sum + d.portfolioReturn, 0) / bigLossDays.length;
  const avgBigWin = bigWinDays.reduce((sum, d) => sum + d.portfolioReturn, 0) / bigWinDays.length;
  
  if (Math.abs(avgBigLoss) > Math.abs(avgBigWin) * 1.5) {
    causes.push({
      cause: '損失カットの欠如',
      description: `大損失日平均${(avgBigLoss * 100).toFixed(2)}% vs 大勝利日平均${(avgBigWin * 100).toFixed(2)}%`,
      impact: '大'
    });
  }
  
  console.log('\n【損失主要原因】');
  causes.forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.cause} [影響度：${c.impact}]`);
    console.log(`   ${c.description}`);
  });
  
  if (causes.length === 0) {
    console.log('\n明確な単一原因は特定できませんでした。複数の要因が絡み合っています。');
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('💡 改善提案');
  console.log('='.repeat(80));
  
  const suggestions = [];
  
  if (predictionAccuracyRate < 50) {
    suggestions.push('• パラメータチューニング：lambdaReg, nFactors, quantile の再最適化');
    suggestions.push('• 事前部分空間の再構築：現在の市場環境に合ったファクター選択');
  }
  
  if (avgShortWinRate < 0.4) {
    suggestions.push('• ショート制限：ショートを半分に減らすか、ロングのみにする');
    suggestions.push('• ショート銘柄選択基準の厳格化');
  }
  
  if (Math.abs(avgBigLoss) > Math.abs(avgBigWin)) {
    suggestions.push('• 日次損失ストップの導入：-2% でポジション解消');
    suggestions.push('• ボラティリティ調整：高ボラティリティ日はポジション縮小');
  }
  
  suggestions.push('• ウォークフォワード分析：パラメータの安定性確認');
  suggestions.push('• 市場環境フィルタ：強気/弱気相場で戦略を切り替え');
  
  console.log('\n' + suggestions.join('\n'));
  
  console.log('\n' + '='.repeat(80));
  
  // JSON 出力
  const outputDir = path.join(__dirname, '..', 'results');
  const output = {
    analysisDate: new Date().toISOString(),
    period: {
      start: retUs[startDate].date,
      end: retUs[endDate].date
    },
    predictionAccuracy: {
      accurateDays: accurateDays.length,
      inaccurateDays: inaccurateDays.length,
      accuracyRate: predictionAccuracyRate,
      avgReturnWhenAccurate,
      avgReturnWhenInaccurate
    },
    correlation: {
      usJp: correlation,
      usStrategy: usStrategyCorrelation
    },
    sectorPerformance: {
      long: longPerformance,
      short: shortPerformance
    },
    bigLossDays: bigLossDays.map(d => ({
      date: d.date,
      return: d.portfolioReturn,
      usReturn: d.usReturn,
      longs: d.longPositions,
      shorts: d.shortPositions
    })),
    bigWinDays: bigWinDays.map(d => ({
      date: d.date,
      return: d.portfolioReturn,
      usReturn: d.usReturn,
      longs: d.longPositions,
      shorts: d.shortPositions
    })),
    causes,
    suggestions
  };
  
  const outputPath = path.join(outputDir, `loss_analysis_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`\n💾 分析結果を保存しました：${outputPath}`);
  
  logger.info('Loss analysis completed', {
    causes: causes.length,
    predictionAccuracyRate
  });
}

main().catch(error => {
  logger.error('Loss analysis failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ エラー:', error.message);
  process.exit(1);
});
