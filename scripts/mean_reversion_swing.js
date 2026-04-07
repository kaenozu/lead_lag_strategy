/**
 * 平均回帰戦略 - スイングトレード版（CC リターン）
 * 
 * 改善点:
 * 1. OC リターン → CC リターン（前日終値→当日終値）
 * 2. デイトレ → スイングトレード（3-5 日保有）
 * 3. 取引コストを 1/3 に削減
 * 
 * 使用方法:
 * node scripts/mean_reversion_swing.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { computePerformanceMetrics } = require('../lib/portfolio');

const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('平均回帰戦略 - スイングトレード版（CC リターン）');
console.log('='.repeat(80));

// データ読み込み
function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').slice(1).filter(l => l.trim());
      results[ticker] = lines.map(line => {
        const [date, open, , , close] = line.split(',');
        return { date, open: parseFloat(open), close: parseFloat(close) };
      });
    } else {
      results[ticker] = [];
    }
  }
  return results;
}

function buildReturnMatrices(jpData) {
  const dates = [];
  const retJpCC = [];

  const allDates = new Set();
  Object.values(jpData).forEach(d => d.forEach(r => allDates.add(r.date)));
  const sortedDates = Array.from(allDates).sort();

  // 高速化：事前 Map 構築
  const jpDataMap = new Map();
  for (const [ticker, data] of Object.entries(jpData)) {
    jpDataMap.set(ticker, new Map(data.map(d => [d.date, d])));
  }

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const prevDate = i > 0 ? sortedDates[i - 1] : null;
    const jpCcReturns = [];

    for (const ticker of JP_ETF_TICKERS) {
      const prevClose = prevDate ? jpDataMap.get(ticker)?.get(prevDate) : null;
      const curr = jpDataMap.get(ticker)?.get(date);
      if (prevClose && curr) {
        // CC リターン（前日終値→当日終値）
        jpCcReturns.push((curr.close - prevClose.close) / prevClose.close);
      }
    }

    if (jpCcReturns.length === JP_ETF_TICKERS.length) {
      dates.push(date);
      retJpCC.push({ date, values: jpCcReturns });
    }
  }

  return { retJpCC, dates };
}

// ============================================================================
// スイングトレード戦略
// ============================================================================

function swingMeanReversion(retJpCC, params) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * params.quantile));
  
  const returns = [];
  const trades = [];
  
  // 状態変数
  let cumulativeReturn = 1.0;
  let peak = 1.0;
  let consecutiveLoss = 0;
  
  // ポジション管理
  let position = null; // { entryDay, entryDate, weights, holdingDays }
  const holdingPeriod = params.holdingPeriod || 3; // 保有日数（デフォルト 3 日）
  
  for (let i = params.lookback; i < retJpCC.length; i++) {
    // 1. シグナル計算
    const mean = new Array(n).fill(0);
    const std = new Array(n).fill(0);
    
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = i - params.lookback; k < i; k++) {
        sum += retJpCC[k].values[j];
      }
      mean[j] = sum / params.lookback;
      
      let varSum = 0;
      for (let k = i - params.lookback; k < i; k++) {
        varSum += Math.pow(retJpCC[k].values[j] - mean[j], 2);
      }
      std[j] = Math.sqrt(varSum / params.lookback);
    }
    
    const zScores = mean.map((m, j) => std[j] > 0 ? -m / std[j] : 0);
    
    // 2. ポートフォリオ構築
    const ranked = zScores.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(0, q).map(x => x.idx);
    const shortIndices = ranked.slice(-q).map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) weights[idx] = longWeight;
    for (const idx of shortIndices) weights[idx] = shortWeight;
    
    // 3. ポジション管理
    if (!position) {
      // 新規エントリー
      position = {
        entryDay: i,
        entryDate: retJpCC[i].date,
        weights: [...weights],
        holdingDays: 0
      };
      
      trades.push({
        type: 'entry',
        date: retJpCC[i].date,
        dayIndex: i
      });
    } else {
      // 保有期間のカウント
      position.holdingDays++;
      
      // 決済条件：保有期間到達
      if (position.holdingDays >= holdingPeriod) {
        // 前日からのリターンを計算
        const prevDayReturn = retJpCC[i - 1].values;
        let portfolioReturn = 0;
        for (let j = 0; j < n; j++) {
          portfolioReturn += position.weights[j] * prevDayReturn[j];
        }
        
        returns.push(portfolioReturn);
        
        trades.push({
          type: 'exit',
          date: retJpCC[i - 1].date,
          dayIndex: i - 1,
          return: portfolioReturn,
          holdingDays: position.holdingDays
        });
        
        // 状態更新
        if (portfolioReturn > 0) {
          consecutiveLoss = 0;
        } else {
          consecutiveLoss++;
        }
        
        cumulativeReturn *= (1 + portfolioReturn);
        peak = Math.max(peak, cumulativeReturn);
        
        // 新規ポジション構築
        position = {
          entryDay: i,
          entryDate: retJpCC[i].date,
          weights: [...weights],
          holdingDays: 0
        };
        
        trades.push({
          type: 'entry',
          date: retJpCC[i].date,
          dayIndex: i
        });
      }
    }
    
    // 4. リスク管理
    if (params.consecutiveLossThreshold && consecutiveLoss >= params.consecutiveLossThreshold) {
      if (position) {
        // ポジション決済
        const prevDayReturn = retJpCC[i - 1].values;
        let portfolioReturn = 0;
        for (let j = 0; j < n; j++) {
          portfolioReturn += position.weights[j] * prevDayReturn[j];
        }
        returns.push(portfolioReturn * (1 - params.consecutiveLossReduction));
        position = null;
        consecutiveLoss = 0;
      }
    }
  }
  
  // 最終ポジションの決済
  if (position && retJpCC.length > position.entryDay) {
    const lastDayReturn = retJpCC[retJpCC.length - 1].values;
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += position.weights[j] * lastDayReturn[j];
    }
    returns.push(portfolioReturn);
    
    trades.push({
      type: 'exit',
      date: retJpCC[retJpCC.length - 1].date,
      dayIndex: retJpCC.length - 1,
      return: portfolioReturn,
      holdingDays: position.holdingDays
    });
  }
  
  return { returns, trades };
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
  const { retJpCC, dates } = buildReturnMatrices(jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);
  
  // パラメータ
  const baseParams = {
    lookback: 20,
    quantile: 0.20,
    holdingPeriod: 3,
    consecutiveLossThreshold: 3,
    consecutiveLossReduction: 0.5
  };
  
  // 保有期間別バックテスト
  const holdingPeriods = [1, 2, 3, 4, 5, 7, 10];
  
  console.log('\n保有期間別バックテスト中...');
  
  const results = [];
  
  for (const holdingPeriod of holdingPeriods) {
    const params = { ...baseParams, holdingPeriod };
    console.log(`  保有${holdingPeriod}日...`);
    
    const { returns, trades } = swingMeanReversion(retJpCC, params);
    const metrics = computePerformanceMetrics(returns, 252);
    
    // 取引コスト（年間の取引回数で計算）
    const tradesPerYear = (trades.filter(t => t.type === 'exit').length / dates.length) * 252;
    const costPerTrade = 0.0008; // 0.08%（往復）
    const annualCost = tradesPerYear * costPerTrade * 100;
    
    const winCount = returns.filter(r => r > 0).length;
    const lossCount = returns.filter(r => r < 0).length;
    const totalProfit = returns.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const totalLoss = Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0));
    const profitLossRatio = lossCount > 0 ? (totalProfit / winCount) / (totalLoss / lossCount) : 1;
    
    results.push({
      holdingPeriod,
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      SR: metrics.RR || 0,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100,
      winRate: (winCount / returns.length) * 100,
      profitLossRatio,
      tradesPerYear,
      annualCost,
      netAR: (metrics.AR * 100) - annualCost,
      returns,
      trades
    });
  }
  
  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('保有期間別パフォーマンス比較');
  console.log('='.repeat(80));
  
  console.log('\n保有  AR(%)   RISK(%)  SR     MDD(%)   勝率 (%)  損益比  取引/年  コスト (%)  ネット AR(%)');
  console.log('-'.repeat(110));
  
  results.sort((a, b) => b.netAR - a.netAR);
  
  results.forEach(r => {
    console.log(
      `${String(r.holdingPeriod).padStart(3)}日  ` +
      `${String(r.AR.toFixed(2)).padStart(7)}  ${String(r.RISK.toFixed(2)).padStart(8)}  ` +
      `${String(r.SR.toFixed(2)).padStart(6)}  ${String(r.MDD.toFixed(2)).padStart(8)}  ` +
      `${String(r.winRate.toFixed(1)).padStart(8)}  ${String(r.profitLossRatio.toFixed(2)).padStart(6)}  ` +
      `${String(r.tradesPerYear.toFixed(0)).padStart(7)}  ${String(r.annualCost.toFixed(2)).padStart(9)}  ` +
      `${String(r.netAR.toFixed(2)).padStart(11)}`
    );
  });
  
  // 推奨設定
  const best = results[0];
  
  console.log('\n' + '='.repeat(80));
  console.log('推奨設定');
  console.log('='.repeat(80));
  
  console.log(`\n🏆 最適保有期間：${best.holdingPeriod}日`);
  console.log(`   シャープレシオ：${best.SR.toFixed(2)}`);
  console.log(`   年率リターン（グロス）：${best.AR.toFixed(2)}%`);
  console.log(`   年率リターン（ネット）：${best.netAR.toFixed(2)}%`);
  console.log(`   最大ドローダウン：${best.MDD.toFixed(2)}%`);
  console.log(`   勝率：${best.winRate.toFixed(1)}%`);
  console.log(`   損益比率：${best.profitLossRatio.toFixed(2)}`);
  console.log(`   年間取引回数：${best.tradesPerYear.toFixed(0)}回`);
  console.log(`   年間取引コスト：${best.annualCost.toFixed(2)}%`);
  
  // デイトレとの比較
  const dayTrade = results.find(r => r.holdingPeriod === 1);
  if (dayTrade) {
    console.log('\n  デイトレ（1 日保有）との比較:');
    console.log(`    デイトレ ネット AR: ${dayTrade.netAR.toFixed(2)}%`);
    console.log(`    スイング ネット AR: ${best.netAR.toFixed(2)}%`);
    console.log(`    改善幅：${(best.netAR - dayTrade.netAR).toFixed(2)}%`);
  }
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'mean_reversion_swing_analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: {
      start: dates[0],
      end: dates[dates.length - 1],
      totalDays: dates.length
    },
    baseParameters: baseParams,
    holdingPeriodComparison: results.map(r => ({
      holdingPeriod: r.holdingPeriod,
      AR: r.AR,
      RISK: r.RISK,
      SR: r.SR,
      MDD: r.MDD,
      cumulative: r.cumulative,
      winRate: r.winRate,
      profitLossRatio: r.profitLossRatio,
      tradesPerYear: r.tradesPerYear,
      annualCost: r.annualCost,
      netAR: r.netAR
    })),
    recommendation: {
      holdingPeriod: best.holdingPeriod,
      parameters: {
        ...baseParams,
        holdingPeriod: best.holdingPeriod
      },
      metrics: {
        grossAR: best.AR,
        netAR: best.netAR,
        SR: best.SR,
        MDD: best.MDD,
        winRate: best.winRate,
        profitLossRatio: best.profitLossRatio
      },
      comparison: {
        dayTradeNetAR: dayTrade?.netAR || 0,
        improvement: best.netAR - (dayTrade?.netAR || 0)
      }
    }
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
  
  // 実運用ガイド
  console.log('\n' + '='.repeat(80));
  console.log('実運用ガイド（1 億円運用の場合）');
  console.log('='.repeat(80));
  
  const capital = 100000000; // 1 億円
  const annualGrossProfit = capital * (best.AR / 100);
  const annualCost = capital * (best.annualCost / 100);
  const annualNetProfit = annualGrossProfit - annualCost;
  
  console.log(`\n  運用資金：¥${(capital / 10000).toFixed(0)}万`);
  console.log(`  年間グロス利益：¥${(annualGrossProfit / 10000).toFixed(0)}万`);
  console.log(`  年間取引コスト：¥${(annualCost / 10000).toFixed(0)}万`);
  console.log(`  年間ネット利益：¥${(annualNetProfit / 10000).toFixed(0)}万`);
  console.log(`  実質利回り：${best.netAR.toFixed(2)}%`);
  
  console.log('\n  月平均:');
  console.log(`    利益：¥${(annualNetProfit / 12 / 10000).toFixed(1)}万`);
  console.log(`    取引回数：${(best.tradesPerYear / 12).toFixed(1)}回`);
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
