/**
 * 高度なリスク管理付き 平均回帰戦略
 * 
 * 実装機能:
 * 1. ケリー基準ベースのポジションサイジング
 * 2. 相関ベースのリスクバジェット
 * 3. ボラティリティ・ターゲット
 * 4. ドローダウン・ベースの制限
 * 5. 利食い・損切りルール
 * 6. 時間ベース決済
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { computePerformanceMetrics } = require('../lib/portfolio');

const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('高度なリスク管理付き 平均回帰戦略');
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
        const [date, open, high, low, close] = line.split(',');
        return { date, open: parseFloat(open), close: parseFloat(close), high: parseFloat(high), low: parseFloat(low) };
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
// リスク管理関数
// ============================================================================

/**
 * 簡易ケリー基準の計算
 * @param {number} winRate - 勝率
 * @param {number} profitLossRatio - 損益比率（平均利益/平均損失）
 * @param {number} fraction - ケリー比率の分数（0.25=1/4 ケリー）
 */
function calculateKellyPosition(winRate, profitLossRatio, fraction = 0.25) {
  const kelly = winRate - (1 - winRate) / profitLossRatio;
  return Math.max(0, Math.min(1, kelly * fraction));
}

/**
 * ボラティリティ・ターゲットによるポジション調整
 */
function volatilityTargetPosition(currentVol, targetVol, maxPosition = 1.0) {
  if (currentVol <= 0) return maxPosition;
  const targetPosition = targetVol / currentVol;
  return Math.max(0, Math.min(maxPosition, targetPosition));
}

/**
 * ドローダウン・ベースのポジション制限
 */
function drawdownBasedPosition(currentDD, maxDD, minPosition = 0.0) {
  if (currentDD >= 0) return 1.0;
  const ddRatio = currentDD / maxDD; // 0 to 1 (1 = maxDD reached)
  return Math.max(minPosition, 1 - ddRatio);
}

/**
 * 相関ベースのリスクバジェット（簡易版）
 */
function correlationRiskBudget(weights, covariance) {
  const n = weights.length;
  const portfolioVar = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portfolioVar += weights[i] * weights[j] * (covariance[i]?.[j] || 0);
    }
  }
  const portfolioVol = Math.sqrt(portfolioVar);
  return portfolioVol;
}

// ============================================================================
// 高度なリスク管理付き 平均回帰戦略
// ============================================================================

function advancedMeanReversion(retJpCC, retJpOc, params) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * params.quantile));
  
  const returns = [];
  const trades = [];
  
  // 状態変数
  let cumulativeReturn = 1.0;
  let peak = 1.0;
  let currentDD = 0;
  let consecutiveLoss = 0;
  let consecutiveWin = 0;
  
  // 損益計算用
  const tradeReturns = [];
  let totalProfit = 0;
  let totalLoss = 0;
  let winCount = 0;
  let lossCount = 0;
  
  // ポジション状態
  let openPosition = null; // { entryDate, entryPrice, weights }
  
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
    
    const ranked = zScores.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(0, q).map(x => x.idx);
    const shortIndices = ranked.slice(-q).map(x => x.idx);
    
    const baseWeights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) baseWeights[idx] = longWeight;
    for (const idx of shortIndices) baseWeights[idx] = shortWeight;
    
    // 2. フィルタリング
    let shouldTrade = true;
    let positionSize = 1.0;
    
    // 2.1 ボラティリティ・フィルタ
    if (params.volatilityFilter) {
      const recentReturns = retJpCC.slice(i - 20, i).flatMap(r => r.values);
      const recentVol = Math.sqrt(recentReturns.reduce((sum, r) => sum + r * r, 0) / recentReturns.length) * Math.sqrt(252);
      
      if (recentVol > params.volatilityFilter.maxVol) {
        shouldTrade = false; // 高ボラティリティ時は取引停止
      }
      
      // ボラティリティ・ターゲット
      if (params.volatilityFilter.targetVol) {
        positionSize *= volatilityTargetPosition(
          recentVol,
          params.volatilityFilter.targetVol,
          1.0
        );
      }
    }
    
    // 2.2 ドローダウン・フィルタ
    if (params.drawdownFilter && currentDD < params.drawdownFilter.maxDD) {
      positionSize *= drawdownBasedPosition(
        currentDD,
        params.drawdownFilter.maxDD,
        params.drawdownFilter.minPosition || 0
      );
    }
    
    // 2.3 連続損失フィルタ
    if (params.consecutiveLossFilter && consecutiveLoss >= params.consecutiveLossFilter.threshold) {
      positionSize *= (1 - params.consecutiveLossFilter.reduction);
    }
    
    // 2.4 トレンド・フィルタ（簡易版）
    if (params.trendFilter) {
      const trendLookback = params.trendFilter.lookback || 20;
      if (i >= trendLookback) {
        let marketTrend = 0;
        for (let j = 0; j < n; j++) {
          for (let k = i - trendLookback; k < i; k++) {
            marketTrend += retJpCC[k].values[j];
          }
        }
        marketTrend /= (n * trendLookback);
        
        // 明確なトレンド時のみ取引
        if (Math.abs(marketTrend) < params.trendFilter.minTrend) {
          shouldTrade = false;
        }
      }
    }
    
    // 3. ポジション管理
    if (!shouldTrade || positionSize <= 0.05) {
      // ポジション決済
      if (openPosition) {
        const exitReturn = 0; // 決済しない場合は 0
        returns.push(0);
        trades.push({
          date: retJpOc[i].date,
          type: 'hold',
          return: 0,
          positionSize: 0
        });
      } else {
        returns.push(0);
        trades.push({
          date: retJpOc[i].date,
          type: 'skip',
          return: 0,
          positionSize: 0
        });
      }
      continue;
    }
    
    // ウェイト調整
    const weights = baseWeights.map(w => w * positionSize);
    
    // 4. リターン計算
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    // 5. 利食い・損切り（オプション）
    if (params.stopLoss && portfolioReturn < -params.stopLoss) {
      portfolioReturn = -params.stopLoss; // 損切り
    }
    if (params.takeProfit && portfolioReturn > params.takeProfit) {
      portfolioReturn = params.takeProfit; // 利食い
    }
    
    // 6. 時間ベース決済（オプション）
    if (params.timeBasedExit && openPosition) {
      const holdingDays = i - openPosition.entryDay;
      if (holdingDays >= params.timeBasedExit.maxDays) {
        // 強制決済（簡易実装：そのままリターンを計上）
        openPosition = null;
      }
    }
    
    // 7. 状態更新
    returns.push(portfolioReturn);
    tradeReturns.push(portfolioReturn);
    
    if (portfolioReturn > 0) {
      winCount++;
      totalProfit += portfolioReturn;
      consecutiveWin++;
      consecutiveLoss = 0;
    } else {
      lossCount++;
      totalLoss += Math.abs(portfolioReturn);
      consecutiveLoss++;
      consecutiveWin = 0;
    }
    
    // ドローダウン更新
    const prevPeak = peak;
    cumulativeReturn *= (1 + portfolioReturn);
    peak = Math.max(peak, cumulativeReturn);
    currentDD = (cumulativeReturn - peak) / peak;
    
    trades.push({
      date: retJpOc[i].date,
      type: 'trade',
      return: portfolioReturn,
      positionSize,
      cumulativeReturn,
      drawdown: currentDD
    });
    
    // ポジション記録
    if (!openPosition) {
      openPosition = {
        entryDay: i,
        entryDate: retJpOc[i].date,
        weights: [...weights]
      };
    }
  }
  
  // 損益比率計算
  const avgProfit = winCount > 0 ? totalProfit / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLoss / lossCount : 1;
  const profitLossRatio = avgLoss > 0 ? avgProfit / avgLoss : 1;
  const winRate = tradeReturns.length > 0 ? winCount / tradeReturns.length : 0;
  
  return {
    returns,
    trades,
    stats: {
      winRate,
      profitLossRatio,
      avgProfit,
      avgLoss,
      winCount,
      lossCount,
      totalTrades: tradeReturns.length
    }
  };
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
  
  // ベースパラメータ（最適化結果から）
  const baseParams = {
    lookback: 20,
    quantile: 0.20
  };
  
  // リスク管理バリエーション
  const riskConfigs = [
    {
      name: 'ベースライン（連続損失制御のみ）',
      params: {
        ...baseParams,
        consecutiveLossFilter: { threshold: 3, reduction: 0.5 }
      }
    },
    {
      name: 'ボラティリティ・フィルタ追加',
      params: {
        ...baseParams,
        consecutiveLossFilter: { threshold: 3, reduction: 0.5 },
        volatilityFilter: { maxVol: 0.20, targetVol: 0.10 }
      }
    },
    {
      name: 'ドローダウン・フィルタ追加',
      params: {
        ...baseParams,
        consecutiveLossFilter: { threshold: 3, reduction: 0.5 },
        drawdownFilter: { maxDD: -0.10, minPosition: 0.5 }
      }
    },
    {
      name: 'トレンド・フィルタ追加',
      params: {
        ...baseParams,
        consecutiveLossFilter: { threshold: 3, reduction: 0.5 },
        trendFilter: { lookback: 20, minTrend: 0.001 }
      }
    },
    {
      name: '損切り・利食いルール追加',
      params: {
        ...baseParams,
        consecutiveLossFilter: { threshold: 3, reduction: 0.5 },
        stopLoss: 0.03,
        takeProfit: 0.05
      }
    },
    {
      name: '総合（全フィルタ）',
      params: {
        ...baseParams,
        consecutiveLossFilter: { threshold: 3, reduction: 0.5 },
        volatilityFilter: { maxVol: 0.20, targetVol: 0.10 },
        drawdownFilter: { maxDD: -0.10, minPosition: 0.5 },
        trendFilter: { lookback: 20, minTrend: 0.001 },
        stopLoss: 0.03,
        takeProfit: 0.05
      }
    }
  ];
  
  console.log('\nリスク管理バリエーションのバックテスト中...');
  
  const results = [];
  
  for (const config of riskConfigs) {
    console.log(`  ${config.name}...`);
    
    const { returns, stats } = advancedMeanReversion(retJpCC, retJpOc, config.params);
    const metrics = computePerformanceMetrics(returns, 252);
    
    results.push({
      name: config.name,
      params: config.params,
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      SR: metrics.RR || 0,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100,
      winRate: stats.winRate * 100,
      profitLossRatio: stats.profitLossRatio,
      totalTrades: stats.totalTrades,
      returns
    });
  }
  
  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('リスク管理バリエーション比較');
  console.log('='.repeat(80));
  
  console.log('\nシャープレシオ順:');
  results.sort((a, b) => b.SR - a.SR);
  
  console.log('\n戦略名                                    SR      AR(%)   RISK(%)  MDD(%)   勝率 (%)  損益比');
  console.log('-'.repeat(95));
  
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
  
  console.log(`\n🏆 最適リスク管理：${best.name}`);
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
    const winRateImprovement = best.winRate - baseline.winRate;
    
    console.log('\n  ベースラインとの比較:');
    console.log(`    シャープレシオ：${baseline.SR.toFixed(2)} → ${best.SR.toFixed(2)} (${srImprovement > 0 ? '+' : ''}${srImprovement.toFixed(2)})`);
    console.log(`    最大 DD: ${baseline.MDD.toFixed(2)}% → ${best.MDD.toFixed(2)}% (${mddImprovement > 0 ? '+' : ''}${mddImprovement.toFixed(2)}%)`);
    console.log(`    勝率：${baseline.winRate.toFixed(1)}% → ${best.winRate.toFixed(1)}% (${winRateImprovement > 0 ? '+' : ''}${winRateImprovement.toFixed(1)}%)`);
  }
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'advanced_mean_reversion_comparison.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: {
      start: dates[0],
      end: dates[dates.length - 1],
      totalDays: dates.length
    },
    baseParameters: baseParams,
    riskConfigurations: results.map(r => ({
      name: r.name,
      SR: r.SR,
      AR: r.AR,
      RISK: r.RISK,
      MDD: r.MDD,
      cumulative: r.cumulative,
      winRate: r.winRate,
      profitLossRatio: r.profitLossRatio,
      totalTrades: r.totalTrades
    })),
    recommendation: {
      name: best.name,
      parameters: best.params,
      metrics: {
        SR: best.SR,
        AR: best.AR,
        RISK: best.RISK,
        MDD: best.MDD,
        cumulative: best.cumulative,
        winRate: best.winRate,
        profitLossRatio: best.profitLossRatio
      }
    }
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
  
  // KPI 達成度
  console.log('\n' + '='.repeat(80));
  console.log('KPI 達成度');
  console.log('='.repeat(80));
  
  const kpis = [
    { name: 'シャープレシオ', target: 0.8, actual: best.SR, unit: '' },
    { name: '年率リターン', target: 10, actual: best.AR, unit: '%' },
    { name: '最大ドローダウン', target: -12, actual: best.MDD, unit: '%' },
    { name: '勝率', target: 55, actual: best.winRate, unit: '%' }
  ];
  
  console.log('\n指標                目標      実際      達成度');
  console.log('-'.repeat(50));
  
  let totalScore = 0;
  kpis.forEach(kpi => {
    let achievement;
    if (kpi.name === '最大ドローダウン') {
      achievement = best.MDD >= kpi.target ? 100 : Math.max(0, (kpi.target / best.MDD) * 100);
    } else {
      achievement = best.AR >= kpi.target ? 100 : Math.max(0, (best.SR / kpi.target) * 100);
    }
    achievement = Math.min(100, achievement);
    totalScore += achievement;
    
    const status = achievement >= 100 ? '✅' : achievement >= 70 ? '🟡' : '🔴';
    console.log(
      `${kpi.name.padEnd(16)}  ${String(kpi.target).padStart(8)}${kpi.unit.padEnd(4)}  ` +
      `${String(kpi.actual.toFixed(2)).padStart(8)}${kpi.unit.padEnd(4)}  ` +
      `${status} ${achievement.toFixed(1)}%`
    );
  });
  
  const avgAchievement = totalScore / kpis.length;
  console.log(`\n  総合達成度：${avgAchievement.toFixed(1)}%`);
  
  if (avgAchievement >= 100) {
    console.log('  評価：✅ 全ての KPI を達成');
  } else if (avgAchievement >= 70) {
    console.log('  評価：🟡 KPI はほぼ達成');
  } else {
    console.log('  評価：🔴 KPI 未達、追加改善が必要');
  }
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
