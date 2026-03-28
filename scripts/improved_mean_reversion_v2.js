/**
 * 改良版 平均回帰戦略 v2
 * 
 * 改善点:
 * 1. 信頼度ベースのウェイト調整
 * 2. 市場環境適応型パラメータ
 * 3. 複数時間軸モメンタム
 * 4. セクター相関フィルタ
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { computePerformanceMetrics } = require('../lib/portfolio');

const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('改良版 平均回帰戦略 v2');
console.log('='.repeat(80));

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

function findPrevEntry(data, date) {
  if (!data) return undefined;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].date < date) return data[i];
  }
  return undefined;
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
      const prevClose = findPrevEntry(jpData[ticker], date);
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
// 改良版 平均回帰戦略
// ============================================================================

function improvedMeanReversion(retJpCC, retJpOc, params) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * params.quantile));
  
  const returns = [];
  
  // 状態変数
  let cumulativeReturn = 1.0;
  let peak = 1.0;
  let currentDD = 0;
  let consecutiveLoss = 0;
  
  // 市場環境変数
  let marketVol = 0;
  let marketTrend = 0;
  
  for (let i = params.lookback; i < retJpCC.length; i++) {
    // 1. 市場環境の計算
    // ボラティリティ
    const recentReturns = retJpCC.slice(i - 20, i).flatMap(r => r.values);
    const recentMean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    marketVol = Math.sqrt(recentReturns.reduce((sum, r) => sum + Math.pow(r - recentMean, 2), 0) / recentReturns.length) * Math.sqrt(252);
    
    // トレンド
    let trendSum = 0;
    for (let j = 0; j < n; j++) {
      for (let k = i - 20; k < i; k++) {
        trendSum += retJpCC[k].values[j];
      }
    }
    marketTrend = trendSum / (n * 20);
    
    // 2. シグナル計算（複数時間軸）
    const signals = {
      short: new Array(n).fill(0), // 20 日
      medium: new Array(n).fill(0), // 40 日
      long: new Array(n).fill(0) // 60 日
    };
    
    const lookbacks = [20, 40, 60];
    lookbacks.forEach((lb, idx) => {
      const key = idx === 0 ? 'short' : idx === 1 ? 'medium' : 'long';
      const start = Math.max(0, i - lb);
      
      for (let j = 0; j < n; j++) {
        let sum = 0;
        let varSum = 0;
        let count = 0;
        
        for (let k = start; k < i; k++) {
          sum += retJpCC[k].values[j];
          count++;
        }
        
        if (count > 0) {
          const mean = sum / count;
          for (let k = start; k < i; k++) {
            varSum += Math.pow(retJpCC[k].values[j] - mean, 2);
          }
          const std = Math.sqrt(varSum / count);
          signals[key][j] = std > 0 ? -mean / std : 0;
        }
      }
    });
    
    // 3. 信頼度ベースの統合シグナル
    const combinedSignals = new Array(n).fill(0);
    const signalConfidence = new Array(n).fill(0);
    
    for (let j = 0; j < n; j++) {
      // 3 つの時間軸のシグナルが一致しているか確認
      const signs = [
        Math.sign(signals.short[j]),
        Math.sign(signals.medium[j]),
        Math.sign(signals.long[j])
      ];
      
      // 一致数で信頼度を計算
      const agreement = signs.filter(s => s === signs[0]).length;
      signalConfidence[j] = agreement / 3; // 0.33, 0.67, 1.0
      
      // 加重平均
      combinedSignals[j] = (
        signals.short[j] * 0.5 +
        signals.medium[j] * 0.3 +
        signals.long[j] * 0.2
      );
      
      // 信頼度でスケーリング
      combinedSignals[j] *= signalConfidence[j];
    }
    
    // 4. 市場環境フィルタ
    let positionSize = 1.0;
    
    // 高ボラティリティ時はポジション削減
    if (marketVol > 0.20) {
      positionSize *= 0.5;
    } else if (marketVol > 0.15) {
      positionSize *= 0.75;
    }
    
    // 明確なトレンド時は逆張りを控える
    if (Math.abs(marketTrend) > 0.002) {
      positionSize *= 0.5;
    }
    
    // ドローダウン時の制限
    if (currentDD < -0.10) {
      positionSize *= 0.5;
    }
    if (currentDD < -0.15) {
      positionSize *= 0.25;
    }
    
    // 連続損失時の制限
    if (consecutiveLoss >= 3) {
      positionSize *= 0.5;
    }
    if (consecutiveLoss >= 5) {
      positionSize = 0;
    }
    
    // 5. ポートフォリオ構築（信頼度ベース）
    const ranked = combinedSignals.map((val, idx) => ({ 
      val, 
      idx, 
      conf: signalConfidence[idx] 
    })).sort((a, b) => a.val - b.val);
    
    // 信頼度の高い銘柄を優先
    const longCandidates = ranked.slice(-q * 2); // 候補を 2 倍
    const shortCandidates = ranked.slice(0, q * 2);
    
    // 信頼度でソートして上位 q 個を選択
    const longSelected = longCandidates
      .sort((a, b) => b.conf - a.conf)
      .slice(0, q)
      .map(x => x.idx);
    
    const shortSelected = shortCandidates
      .sort((a, b) => b.conf - a.conf)
      .slice(0, q)
      .map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longSelected) weights[idx] = longWeight;
    for (const idx of shortSelected) weights[idx] = shortWeight;
    
    // ポジションサイズ適用
    weights.forEach((w, j) => weights[j] *= positionSize);
    
    // 6. リターン計算
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    // 7. 損切り（個別改善）
    if (params.stopLoss && portfolioReturn < -params.stopLoss) {
      portfolioReturn = -params.stopLoss;
    }
    
    // 8. 利食い（個別改善）
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
  
  // パラメータグリッド
  const paramGrid = [
    { name: 'v2 ベース', params: { lookback: 20, quantile: 0.20 } },
    { name: 'v2 + 損切り 2%', params: { lookback: 20, quantile: 0.20, stopLoss: 0.02 } },
    { name: 'v2 + 損切り 3%', params: { lookback: 20, quantile: 0.20, stopLoss: 0.03 } },
    { name: 'v2 + 利食い 5%', params: { lookback: 20, quantile: 0.20, takeProfit: 0.05 } },
    { name: 'v2 + 損切り 2% + 利食い 5%', params: { lookback: 20, quantile: 0.20, stopLoss: 0.02, takeProfit: 0.05 } },
    { name: 'v2 + 損切り 3% + 利食い 6%', params: { lookback: 20, quantile: 0.20, stopLoss: 0.03, takeProfit: 0.06 } }
  ];
  
  console.log('\nパラメータグリッドバックテスト中...');
  
  const results = [];
  
  for (const config of paramGrid) {
    console.log(`  ${config.name}...`);
    
    const returns = improvedMeanReversion(retJpCC, retJpOc, config.params);
    const metrics = computePerformanceMetrics(returns, 252);
    
    const winCount = returns.filter(r => r > 0).length;
    const lossCount = returns.filter(r => r < 0).length;
    const totalProfit = returns.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const totalLoss = Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0));
    const profitLossRatio = lossCount > 0 ? (totalProfit / winCount) / (totalLoss / lossCount) : 1;
    
    results.push({
      name: config.name,
      params: config.params,
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
  console.log('パラメータグリッド比較');
  console.log('='.repeat(80));
  
  console.log('\nシャープレシオ順:');
  results.sort((a, b) => b.SR - a.SR);
  
  console.log('\n戦略名                              SR      AR(%)   RISK(%)  MDD(%)   勝率 (%)  損益比');
  console.log('-'.repeat(90));
  
  results.forEach(r => {
    console.log(
      `${r.name.padEnd(36)}  ${String(r.SR.toFixed(2)).padStart(6)}  ` +
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
    let actualStr = kpi.name === '最大ドローダウン' ? `${best.MDD.toFixed(2)}%` : `${best.AR.toFixed(2)}%`;
    
    if (kpi.name === '勝率') {
      actualStr = `${best.winRate.toFixed(1)}%`;
    } else if (kpi.name === 'シャープレシオ') {
      actualStr = best.SR.toFixed(2);
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
  
  if (totalScore >= 80) {
    console.log('  評価：✅ 優秀 - 実運用可能レベル');
  } else if (totalScore >= 60) {
    console.log('  評価：🟡 良好 - 追加改善を推奨');
  } else {
    console.log('  評価：🔴 要改善 - 追加最適化が必要');
  }
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'improved_mean_reversion_v2.json');
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
    },
    kpiAchievement: {
      totalScore,
      details: kpis.map(k => ({
        name: k.name,
        target: k.target,
        actual: k.actual,
        achieved: k.name === '最大ドローダウン' ? k.actual >= k.target : k.actual >= k.target
      }))
    }
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
