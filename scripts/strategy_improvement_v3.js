/**
 * 戦略改善 v3 - 動的パラメータ調整 + ボラティリティ・ターゲティング
 * 
 * 改善点:
 * 1. 市場ボラティリティに応じて lookback を動的調整
 * 2. 目標ボラティリティベースのポジションサイジング
 * 3. 市場トレンドフィルタの強化
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { computePerformanceMetrics } = require('../lib/portfolio');

const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('戦略改善 v3 - 動的パラメータ調整 + ボラティリティ・ターゲティング');
console.log('='.repeat(80));

function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').slice(1).filter(l => l.trim());
      results[ticker] = lines.map(line => {
        const [date, open, high, low, close] = line.split(',');
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
  const retJpOc = [];

  const allDates = new Set();
  Object.values(jpData).forEach(d => d.forEach(r => allDates.add(r.date)));
  const sortedDates = Array.from(allDates).sort();

  for (const date of sortedDates) {
    const jpCcReturns = [];
    const jpOcReturns = [];

    for (const ticker of JP_ETF_TICKERS) {
      const prevClose = jpData[ticker]?.find(r => r.date < date);
      const curr = jpData[ticker]?.find(r => r.date === date);
      if (prevClose && curr) {
        jpCcReturns.push((curr.close - prevClose.close) / prevClose.close);
        jpOcReturns.push((curr.close - curr.open) / curr.open);
      }
    }

    if (jpCcReturns.length === JP_ETF_TICKERS.length) {
      dates.push(date);
      retJpCC.push({ date, values: jpCcReturns });
      retJpOc.push({ date, values: jpOcReturns });
    }
  }

  return { retJpCC, retJpOc, dates };
}

// ============================================================================
// 動的パラメータ調整関数
// ============================================================================

/**
 * 市場ボラティリティに応じて lookback を動的調整
 */
function getDynamicLookback(marketVol, params) {
  if (marketVol > params.volHigh) return params.lookbackMin;      // 高ボラ：短期
  if (marketVol < params.volLow) return params.lookbackMax;       // 低ボラ：長期
  // 線形補間
  const ratio = (marketVol - params.volLow) / (params.volHigh - params.volLow);
  return Math.round(params.lookbackMax - ratio * (params.lookbackMax - params.lookbackMin));
}

/**
 * 市場トレンドに応じて quantile を調整
 */
function getDynamicQuantile(marketTrend, params) {
  if (Math.abs(marketTrend) > params.trendHigh) return params.quantileMin;  // トレンド：絞る
  if (Math.abs(marketTrend) < params.trendLow) return params.quantileMax;   // レンジ：広げる
  // 線形補間
  const ratio = (Math.abs(marketTrend) - params.trendLow) / (params.trendHigh - params.trendLow);
  return params.quantileMax - ratio * (params.quantileMax - params.quantileMin);
}

// ============================================================================
// ボラティリティ・ターゲティング
// ============================================================================

/**
 * 目標ボラティリティベースのポジションサイジング
 */
function volatilityTargetPosition(recentVol, targetVol, minPos = 0.5, maxPos = 1.5) {
  if (recentVol <= 0) return maxPos;
  const targetPosition = targetVol / recentVol;
  return Math.max(minPos, Math.min(maxPos, targetPosition));
}

// ============================================================================
// 戦略改善 v3
// ============================================================================

function improvedStrategyV3(retJpCC, retJpOc, params) {
  const n = retJpCC[0].values.length;
  
  const returns = [];
  
  // 状態変数
  let cumulativeReturn = 1.0;
  let peak = 1.0;
  let currentDD = 0;
  let consecutiveLoss = 0;
  
  for (let i = params.lookbackMax; i < retJpCC.length; i++) {
    // 1. 市場環境の計算
    const recentReturns = retJpCC.slice(i - 20, i).flatMap(r => r.values);
    const recentMean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    const marketVol = Math.sqrt(recentReturns.reduce((sum, r) => sum + Math.pow(r - recentMean, 2), 0) / recentReturns.length) * Math.sqrt(252);
    
    // 市場トレンド
    let trendSum = 0;
    for (let j = 0; j < n; j++) {
      for (let k = i - 20; k < i; k++) {
        trendSum += retJpCC[k].values[j];
      }
    }
    const marketTrend = trendSum / (n * 20);
    
    // 2. 動的パラメータ調整
    const dynamicLookback = getDynamicLookback(marketVol, params);
    const dynamicQuantile = getDynamicQuantile(marketTrend, params);
    
    // 3. シグナル計算（動的パラメータ使用）
    const mean = new Array(n).fill(0);
    const std = new Array(n).fill(0);
    
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = i - dynamicLookback; k < i; k++) {
        sum += retJpCC[k].values[j];
      }
      mean[j] = sum / dynamicLookback;
      
      let varSum = 0;
      for (let k = i - dynamicLookback; k < i; k++) {
        varSum += Math.pow(retJpCC[k].values[j] - mean[j], 2);
      }
      std[j] = Math.sqrt(varSum / dynamicLookback);
    }
    
    const zScores = mean.map((m, j) => std[j] > 0 ? -m / std[j] : 0);
    
    // 4. ポートフォリオ構築（動的 quantile）
    const q = Math.max(1, Math.floor(n * dynamicQuantile));
    
    const ranked = zScores.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(0, q).map(x => x.idx);
    const shortIndices = ranked.slice(-q).map(x => x.idx);
    
    const baseWeights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) baseWeights[idx] = longWeight;
    for (const idx of shortIndices) baseWeights[idx] = shortWeight;
    
    // 5. ボラティリティ・ターゲティング
    let positionSize = volatilityTargetPosition(
      marketVol,
      params.targetVol,
      params.minPosition,
      params.maxPosition
    );
    
    // 6. 追加フィルタ
    // 高ボラティリティ時は取引停止
    if (marketVol > params.maxVol) {
      positionSize = 0;
    }
    
    // ドローダウン時の制限
    if (currentDD < -params.maxDD) {
      positionSize *= 0.5;
    }
    
    // 連続損失時の制限
    if (consecutiveLoss >= params.consecutiveLossThreshold) {
      positionSize *= (1 - params.consecutiveLossReduction);
    }
    
    // ウェイト調整
    const weights = baseWeights.map(w => w * positionSize);
    
    // 7. リターン計算
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    // 8. 損切り・利食い
    if (params.stopLoss && portfolioReturn < -params.stopLoss) {
      portfolioReturn = -params.stopLoss;
    }
    if (params.takeProfit && portfolioReturn > params.takeProfit) {
      portfolioReturn = params.takeProfit;
    }
    
    // 9. 状態更新
    returns.push(portfolioReturn);
    
    if (portfolioReturn > 0) {
      consecutiveLoss = 0;
    } else {
      consecutiveLoss++;
    }
    
    cumulativeReturn *= (1 + portfolioReturn);
    peak = Math.max(peak, cumulativeReturn);
    currentDD = (cumulativeReturn - peak) / peak;
  }
  
  return returns;
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
  const { retJpCC, retJpOc, dates } = buildReturnMatrices(jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);
  
  // ベースライン（最適化済みパラメータ）
  const baselineParams = {
    lookback: 20,
    lookbackMin: 10,
    lookbackMax: 40,
    quantile: 0.20,
    quantileMin: 0.15,
    quantileMax: 0.25,
    volHigh: 0.20,
    volLow: 0.10,
    trendHigh: 0.002,
    trendLow: 0.0005,
    targetVol: 0.10,
    minPosition: 0.5,
    maxPosition: 1.5,
    maxVol: 0.25,
    maxDD: 0.10,
    consecutiveLossThreshold: 3,
    consecutiveLossReduction: 0.5,
    stopLoss: 0.03,
    takeProfit: 0.05
  };
  
  // パラメータバリエーション
  const paramVariations = [
    {
      name: 'ベースライン（静的パラメータ）',
      params: { ...baselineParams, lookback: 20, quantile: 0.20 }
    },
    {
      name: 'v3 動的パラメータ調整',
      params: { ...baselineParams }
    },
    {
      name: 'v3 + ターゲットボラ 8%',
      params: { ...baselineParams, targetVol: 0.08 }
    },
    {
      name: 'v3 + ターゲットボラ 12%',
      params: { ...baselineParams, targetVol: 0.12 }
    },
    {
      name: 'v3 + 厳格フィルタ',
      params: { ...baselineParams, maxVol: 0.18, maxDD: 0.08 }
    },
    {
      name: 'v3 + 緩和フィルタ',
      params: { ...baselineParams, maxVol: 0.30, maxDD: 0.15 }
    }
  ];
  
  console.log('\nパラメータバリエーションのバックテスト中...');
  
  const results = [];
  
  for (const variation of paramVariations) {
    console.log(`  ${variation.name}...`);
    
    const returns = improvedStrategyV3(retJpCC, retJpOc, variation.params);
    const metrics = computePerformanceMetrics(returns, 252);
    
    const winCount = returns.filter(r => r > 0).length;
    const lossCount = returns.filter(r => r < 0).length;
    const totalProfit = returns.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const totalLoss = Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0));
    const profitLossRatio = lossCount > 0 ? (totalProfit / winCount) / (totalLoss / lossCount) : 1;
    
    results.push({
      name: variation.name,
      params: variation.params,
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      SR: metrics.RR || 0,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100,
      winRate: (winCount / returns.length) * 100,
      profitLossRatio,
      totalTrades: returns.length,
      returns
    });
  }
  
  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('パラメータバリエーション比較');
  console.log('='.repeat(80));
  
  console.log('\nシャープレシオ順:');
  results.sort((a, b) => b.SR - a.SR);
  
  console.log('\n戦略名                                    SR      AR(%)   RISK(%)  MDD(%)   勝率 (%)  損益比');
  console.log('-'.repeat(100));
  
  results.forEach(r => {
    const nameShort = r.name.length > 40 ? r.name.substring(0, 37) + '...' : r.name;
    console.log(
      `${nameShort.padEnd(40)}  ${String(r.SR.toFixed(2)).padStart(6)}  ` +
      `${String(r.AR.toFixed(2)).padStart(7)}  ${String(r.RISK.toFixed(2)).padStart(7)}  ` +
      `${String(r.MDD.toFixed(2)).padStart(8)}  ${String(r.winRate.toFixed(1)).padStart(8)}  ${String(r.profitLossRatio.toFixed(2)).padStart(6)}`
    );
  });
  
  // 推奨設定
  const best = results[0];
  
  console.log('\n' + '='.repeat(80));
  console.log('推奨設定');
  console.log('='.repeat(80));
  
  console.log(`\n🏆 最適戦略：${best.name}`);
  console.log(`   シャープレシオ：${best.SR.toFixed(2)}`);
  console.log(`   年率リターン：${best.AR.toFixed(2)}%`);
  console.log(`   年率リスク：${best.RISK.toFixed(2)}%`);
  console.log(`   最大ドローダウン：${best.MDD.toFixed(2)}%`);
  console.log(`   勝率：${best.winRate.toFixed(1)}%`);
  console.log(`   損益比率：${best.profitLossRatio.toFixed(2)}`);
  
  // ベースラインとの比較
  const baseline = results.find(r => r.name.includes('ベースライン'));
  if (baseline) {
    const srImprovement = best.SR - baseline.SR;
    const mddImprovement = best.MDD - baseline.MDD;
    const arImprovement = best.AR - baseline.AR;
    
    console.log('\n  ベースラインとの比較:');
    console.log(`    シャープレシオ：${baseline.SR.toFixed(2)} → ${best.SR.toFixed(2)} (${srImprovement > 0 ? '+' : ''}${srImprovement.toFixed(2)})`);
    console.log(`    年率リターン：${baseline.AR.toFixed(2)}% → ${best.AR.toFixed(2)}% (${arImprovement > 0 ? '+' : ''}${arImprovement.toFixed(2)}%)`);
    console.log(`    最大 DD: ${baseline.MDD.toFixed(2)}% → ${best.MDD.toFixed(2)}% (${mddImprovement > 0 ? '+' : ''}${mddImprovement.toFixed(2)}%)`);
  }
  
  // KPI 達成度
  console.log('\n' + '='.repeat(80));
  console.log('KPI 達成度');
  console.log('='.repeat(80));
  
  const kpis = [
    { name: 'シャープレシオ', target: 0.8, actual: best.SR },
    { name: '年率リターン', target: 10, actual: best.AR },
    { name: '最大ドローダウン', target: -12, actual: best.MDD },
    { name: '勝率', target: 55, actual: best.winRate }
  ];
  
  console.log('\n指標                目標      実際      達成状況');
  console.log('-'.repeat(55));
  
  kpis.forEach(kpi => {
    let achieved;
    if (kpi.name === '最大ドローダウン') {
      achieved = best.MDD >= kpi.target;
    } else {
      achieved = best.AR >= kpi.target;
    }
    
    const status = achieved ? '✅' : best.SR >= 0.7 ? '🟡' : '🔴';
    const targetStr = kpi.name === '最大ドローダウン' ? `${kpi.target}%` : String(kpi.target);
    let actualStr;
    if (kpi.name === '最大ドローダウン') {
      actualStr = `${best.MDD.toFixed(2)}%`;
    } else if (kpi.name === '勝率') {
      actualStr = `${best.winRate.toFixed(1)}%`;
    } else if (kpi.name === 'シャープレシオ') {
      actualStr = best.SR.toFixed(2);
    } else {
      actualStr = `${best.AR.toFixed(2)}%`;
    }
    
    console.log(
      `${kpi.name.padEnd(16)}  ${targetStr.padStart(8)}  ` +
      `${actualStr.padStart(8)}  ${status}`
    );
  });
  
  // 総合評価
  const srScore = Math.min(100, (best.SR / 0.8) * 100);
  const arScore = Math.min(100, (best.AR / 10) * 100);
  const mddScore = best.MDD >= -12 ? 100 : Math.max(0, (best.MDD / -12) * 100);
  const wrScore = Math.min(100, (best.winRate / 55) * 100);
  
  const totalScore = (srScore + arScore + mddScore + wrScore) / 4;
  
  console.log(`\n  総合スコア：${totalScore.toFixed(1)}/100`);
  
  if (totalScore >= 90) {
    console.log('  評価：✅ 優秀 - 全 KPI 達成');
  } else if (totalScore >= 75) {
    console.log('  評価：🟡 良好 - 一部 KPI 未達');
  } else {
    console.log('  評価：🔴 要改善 - 追加最適化が必要');
  }
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'strategy_improvement_v3.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: {
      start: dates[0],
      end: dates[dates.length - 1],
      totalDays: dates.length
    },
    strategies: results.map(r => ({
      name: r.name,
      SR: r.SR,
      AR: r.AR,
      RISK: r.RISK,
      MDD: r.MDD,
      cumulative: r.cumulative,
      winRate: r.winRate,
      profitLossRatio: r.profitLossRatio
    })),
    recommendation: {
      name: best.name,
      parameters: {
        lookbackMin: best.params.lookbackMin,
        lookbackMax: best.params.lookbackMax,
        quantileMin: best.params.quantileMin,
        quantileMax: best.params.quantileMax,
        targetVol: best.params.targetVol,
        targetVolMin: best.params.minPosition,
        targetVolMax: best.params.maxPosition
      },
      metrics: {
        SR: best.SR,
        AR: best.AR,
        RISK: best.RISK,
        MDD: best.MDD,
        cumulative: best.cumulative,
        winRate: best.winRate,
        profitLossRatio: best.profitLossRatio
      }
    },
    comparison: {
      baseline: baseline ? {
        name: baseline.name,
        SR: baseline.SR,
        AR: baseline.AR,
        MDD: baseline.MDD
      } : null,
      improvement: baseline ? {
        srImprovement: best.SR - baseline.SR,
        arImprovement: best.AR - baseline.AR,
        mddImprovement: best.MDD - baseline.MDD
      } : null
    }
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
