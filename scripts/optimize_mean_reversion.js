/**
 * 平均回帰戦略のパラメータ最適化
 * グリッドサーチで最適パラメータを探索
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { computePerformanceMetrics } = require('../lib/portfolio');

const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('平均回帰戦略 - パラメータ最適化');
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

// 平均回帰戦略
function meanReversionStrategy(retJpCC, retJpOc, lookback, quantile) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * quantile));
  const returns = [];
  
  for (let i = lookback; i < retJpCC.length; i++) {
    const mean = new Array(n).fill(0);
    const std = new Array(n).fill(0);
    
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = i - lookback; k < i; k++) {
        sum += retJpCC[k].values[j];
      }
      mean[j] = sum / lookback;
      
      let varSum = 0;
      for (let k = i - lookback; k < i; k++) {
        varSum += Math.pow(retJpCC[k].values[j] - mean[j], 2);
      }
      std[j] = Math.sqrt(varSum / lookback);
    }
    
    const zScores = mean.map((m, j) => std[j] > 0 ? -m / std[j] : 0);
    
    const ranked = zScores.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(0, q).map(x => x.idx);
    const shortIndices = ranked.slice(-q).map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) weights[idx] = longWeight;
    for (const idx of shortIndices) weights[idx] = shortWeight;
    
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// リスク管理付き平均回帰戦略
function meanReversionWithRiskManagement(retJpCC, retJpOc, lookback, quantile, riskConfig) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * quantile));
  const returns = [];
  
  let cumulativeReturn = 1.0;
  let peak = 1.0;
  let currentDD = 0;
  let consecutiveLoss = 0;
  
  for (let i = lookback; i < retJpCC.length; i++) {
    const mean = new Array(n).fill(0);
    const std = new Array(n).fill(0);
    
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = i - lookback; k < i; k++) {
        sum += retJpCC[k].values[j];
      }
      mean[j] = sum / lookback;
      
      let varSum = 0;
      for (let k = i - lookback; k < i; k++) {
        varSum += Math.pow(retJpCC[k].values[j] - mean[j], 2);
      }
      std[j] = Math.sqrt(varSum / lookback);
    }
    
    const zScores = mean.map((m, j) => std[j] > 0 ? -m / std[j] : 0);
    
    const ranked = zScores.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(0, q).map(x => x.idx);
    const shortIndices = ranked.slice(-q).map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) weights[idx] = longWeight;
    for (const idx of shortIndices) weights[idx] = shortWeight;
    
    // リスク管理
    let positionSize = 1.0;
    
    // 1. 最大ドローダウンベースのポジション制限
    if (riskConfig.maxDD && currentDD < -riskConfig.maxDD) {
      positionSize = 0.5; // DD が閾値を超えたらポジション半分
    }
    
    // 2. 連続損失ベースのポジション制限
    if (riskConfig.consecutiveLossThreshold && consecutiveLoss >= riskConfig.consecutiveLossThreshold) {
      positionSize = 1.0 - (riskConfig.consecutiveLossReduction || 0);
    }
    
    // 3. ボラティリティベースのポジション制限
    if (riskConfig.targetVol) {
      const recentReturns = returns.slice(-20);
      if (recentReturns.length >= 20) {
        const mean = recentReturns.reduce((a, b) => a + b, 0) / 20;
        const vol = Math.sqrt(recentReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / 20) * Math.sqrt(252);
        if (vol > riskConfig.targetVol) {
          positionSize *= riskConfig.targetVol / vol;
        }
      }
    }
    
    weights.forEach((w, j) => weights[j] = w * positionSize);
    
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    // 更新
    cumulativeReturn *= (1 + portfolioReturn);
    peak = Math.max(peak, cumulativeReturn);
    currentDD = (cumulativeReturn - peak) / peak;
    
    if (portfolioReturn < 0) {
      consecutiveLoss++;
    } else {
      consecutiveLoss = 0;
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// メイン処理
async function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
  const { retJpCC, retJpOc, dates } = buildReturnMatrices(jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);
  
  // パラメータグリッド
  const lookbackParams = [10, 20, 30, 40, 60, 80];
  const quantileParams = [0.2, 0.25, 0.3, 0.35, 0.4];
  
  console.log('\nパラメータグリッドサーチ中...');
  console.log(`  lookback: [${lookbackParams.join(', ')}]`);
  console.log(`  quantile: [${quantileParams.join(', ')}]`);
  console.log(`  組み合わせ数：${lookbackParams.length * quantileParams.length}`);
  
  const results = [];
  
  for (const lookback of lookbackParams) {
    for (const quantile of quantileParams) {
      const returns = meanReversionStrategy(retJpCC, retJpOc, lookback, quantile);
      const metrics = computePerformanceMetrics(returns, 252);
      
      results.push({
        lookback,
        quantile,
        AR: metrics.AR * 100,
        RISK: metrics.RISK * 100,
        SR: metrics.RR || 0,
        MDD: metrics.MDD * 100,
        cumulative: (metrics.Cumulative - 1) * 100,
        winRate: (returns.filter(r => r > 0).length / returns.length) * 100,
        returns
      });
    }
  }
  
  // シャープレシオでソート
  results.sort((a, b) => b.SR - a.SR);
  
  console.log('\n' + '='.repeat(80));
  console.log('パラメータ最適化結果（シャープレシオ順）');
  console.log('='.repeat(80));
  
  console.log('\nRank  Lookback  Quantile  SR      AR(%)   MDD(%)   勝率 (%)');
  console.log('-'.repeat(70));
  
  results.slice(0, 10).forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${String(r.lookback).padStart(8)}  ${String(r.quantile.toFixed(2)).padStart(8)}  ` +
      `${String(r.SR.toFixed(2)).padStart(6)}  ${String(r.AR.toFixed(2)).padStart(7)}  ` +
      `${String(r.MDD.toFixed(2)).padStart(8)}  ${String(r.winRate.toFixed(1)).padStart(8)}`
    );
  });
  
  // 最適パラメータでのリスク管理付きバックテスト
  console.log('\n' + '='.repeat(80));
  console.log('リスク管理付きバックテスト');
  console.log('='.repeat(80));

  // 結果が空の場合はエラー
  if (results.length === 0) {
    console.error('エラー：最適化結果が空です。パラメータグリッドを見直してください。');
    return;
  }

  const bestParams = results[0];
  console.log(`\n最適パラメータ：lookback=${bestParams.lookback}, quantile=${bestParams.quantile.toFixed(2)}`);
  
  const riskConfigs = [
    { name: 'なし', config: {} },
    { name: 'DD 制御 (15%)', config: { maxDD: 0.15 } },
    { name: '連続損失 (3 日)', config: { consecutiveLossThreshold: 3, consecutiveLossReduction: 0.5 } },
    { name: 'ボラティリティ (10%)', config: { targetVol: 0.10 } },
    { name: '総合', config: { maxDD: 0.15, consecutiveLossThreshold: 3, consecutiveLossReduction: 0.5, targetVol: 0.10 } }
  ];
  
  const riskResults = [];
  
  for (const { name, config } of riskConfigs) {
    const returns = meanReversionWithRiskManagement(retJpCC, retJpOc, bestParams.lookback, bestParams.quantile, config);
    const metrics = computePerformanceMetrics(returns, 252);
    
    riskResults.push({
      name,
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      SR: metrics.RR || 0,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100,
      winRate: (returns.filter(r => r > 0).length / returns.length) * 100
    });
  }
  
  console.log('\nリスク管理比較:');
  console.log('設定                  SR      AR(%)   RISK(%)  MDD(%)   勝率 (%)');
  console.log('-'.repeat(70));
  
  riskResults.forEach(r => {
    console.log(
      `${r.name.padEnd(20)}  ${String(r.SR.toFixed(2)).padStart(6)}  ${String(r.AR.toFixed(2)).padStart(7)}  ` +
      `${String(r.RISK.toFixed(2)).padStart(7)}  ${String(r.MDD.toFixed(2)).padStart(8)}  ${String(r.winRate.toFixed(1)).padStart(8)}`
    );
  });
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'mean_reversion_optimization.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: {
      start: dates[0],
      end: dates[dates.length - 1],
      totalDays: dates.length
    },
    parameterGrid: {
      lookback: lookbackParams,
      quantile: quantileParams
    },
    top10Results: results.slice(0, 10).map(r => ({
      lookback: r.lookback,
      quantile: r.quantile,
      AR: r.AR,
      RISK: r.RISK,
      SR: r.SR,
      MDD: r.MDD,
      cumulative: r.cumulative,
      winRate: r.winRate
    })),
    bestParameters: {
      lookback: bestParams.lookback,
      quantile: bestParams.quantile
    },
    riskManagementComparison: riskResults,
    recommendation: riskResults.sort((a, b) => b.SR - a.SR)[0]
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
  
  // 推奨設定
  const bestRiskConfig = riskResults.sort((a, b) => b.SR - a.SR)[0];
  
  console.log('\n' + '='.repeat(80));
  console.log('推奨設定');
  console.log('='.repeat(80));
  
  console.log(`\n🏆 最適リスク管理：${bestRiskConfig.name}`);
  console.log(`   シャープレシオ：${bestRiskConfig.SR.toFixed(2)}`);
  console.log(`   年率リターン：${bestRiskConfig.AR.toFixed(2)}%`);
  console.log(`   最大ドローダウン：${bestRiskConfig.MDD.toFixed(2)}%`);
  
  console.log('\n  最終パラメータ:');
  console.log(`    lookback: ${bestParams.lookback}`);
  console.log(`    quantile: ${bestParams.quantile.toFixed(2)}`);
  console.log(`    リスク管理: ${bestRiskConfig.name}`);
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
