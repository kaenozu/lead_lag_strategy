/**
 * 代替戦略探索ツール
 * 複数の代替戦略を実装・比較し、有望な戦略を特定
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { computePerformanceMetrics } = require('../lib/portfolio');

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('代替戦略探索ツール');
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
        return { 
          date, 
          open: parseFloat(open), 
          high: parseFloat(high), 
          low: parseFloat(low), 
          close: parseFloat(close) 
        };
      });
    } else {
      results[ticker] = [];
    }
  }
  return results;
}

function buildReturnMatrices(usData, jpData) {
  const dates = [];
  const retUs = [];
  const retJpCC = [];
  const retJpOc = [];

  const allDates = new Set();
  Object.values(usData).forEach(d => d.forEach(r => allDates.add(r.date)));
  Object.values(jpData).forEach(d => d.forEach(r => allDates.add(r.date)));

  const sortedDates = Array.from(allDates).sort();

  // 高速化：事前 Map 構築（O(n) → O(1) 検索）
  const usDataMap = new Map();
  const jpDataMap = new Map();
  for (const [ticker, data] of Object.entries(usData)) {
    usDataMap.set(ticker, new Map(data.map(d => [d.date, d])));
  }
  for (const [ticker, data] of Object.entries(jpData)) {
    jpDataMap.set(ticker, new Map(data.map(d => [d.date, d])));
  }

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const prevDate = i > 0 ? sortedDates[i - 1] : null;
    const usReturns = [];
    const jpCcReturns = [];
    const jpOcReturns = [];

    for (const ticker of US_ETF_TICKERS) {
      const prev = prevDate ? usDataMap.get(ticker)?.get(prevDate) : null;
      const curr = usDataMap.get(ticker)?.get(date);
      if (prev && curr) {
        usReturns.push((curr.close - prev.close) / prev.close);
      }
    }

    for (const ticker of JP_ETF_TICKERS) {
      const prevClose = prevDate ? jpDataMap.get(ticker)?.get(prevDate) : null;
      const curr = jpDataMap.get(ticker)?.get(date);
      if (prevClose && curr) {
        // CC リターン（前日終値から当日終値）- シグナル計算用
        jpCcReturns.push((curr.close - prevClose.close) / prevClose.close);
        // OC リターン（当日始値から当日終値）- リターン計算用
        jpOcReturns.push((curr.close - curr.open) / curr.open);
      }
    }

    if (usReturns.length === US_ETF_TICKERS.length &&
        jpCcReturns.length === JP_ETF_TICKERS.length) {
      dates.push(date);
      retUs.push({ date, values: usReturns });
      retJpCC.push({ date, values: jpCcReturns });
      retJpOc.push({ date, values: jpOcReturns });
    }
  }

  return { retUs, retJpCC, retJpOc, dates };
}

// ============================================================================
// 戦略 1: 単純モメンタム（OC リターン使用）
// ============================================================================
function simpleMomentumStrategy(retJpCC, retJpOc, momentumWindow = 20, quantile = 0.3) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * quantile));
  const returns = [];
  
  for (let i = momentumWindow; i < retJpCC.length; i++) {
    // 過去 momentumWindow 日の CC リターンでモメンタム計算
    const momentum = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let k = i - momentumWindow; k < i; k++) {
        momentum[j] += retJpCC[k].values[j];
      }
    }
    
    // モメンタムでソート
    const ranked = momentum.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(-q).map(x => x.idx);
    const shortIndices = ranked.slice(0, q).map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) weights[idx] = longWeight;
    for (const idx of shortIndices) weights[idx] = shortWeight;
    
    // 当日の OC リターンを使用（朝に構築して終値で決済）
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// ============================================================================
// 戦略 2: 平均回帰（OC リターン使用）
// ============================================================================
function meanReversionStrategy(retJpCC, retJpOc, lookback = 20, quantile = 0.3) {
  const n = retJpCC[0].values.length;
  const q = Math.max(1, Math.floor(n * quantile));
  const returns = [];
  
  for (let i = lookback; i < retJpCC.length; i++) {
    // 過去 lookback 日の CC リターンで平均・標準偏差計算
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
    
    // Z スコア（低い＝アンダーパフォーム＝ロング、高い＝アウトパフォーム＝ショート）
    const zScores = mean.map((m, j) => std[j] > 0 ? -m / std[j] : 0);
    
    // Z スコアでソート
    const ranked = zScores.map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    
    const longIndices = ranked.slice(0, q).map(x => x.idx);
    const shortIndices = ranked.slice(-q).map(x => x.idx);
    
    const weights = new Array(n).fill(0);
    const longWeight = 1.0 / q;
    const shortWeight = -1.0 / q;
    
    for (const idx of longIndices) weights[idx] = longWeight;
    for (const idx of shortIndices) weights[idx] = shortWeight;
    
    // 当日の OC リターンを使用
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// ============================================================================
// 戦略 3: リスクパリティ
// ============================================================================
function riskParityStrategy(retJpCC, retJpOc, lookback = 60) {
  const n = retJpCC[0].values.length;
  const returns = [];
  
  for (let i = lookback; i < retJpCC.length; i++) {
    // 各資産のボラティリティを計算
    const volatilities = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      let sum = 0;
      let varSum = 0;
      for (let k = i - lookback; k < i; k++) {
        const r = retJpCC[k].values[j];
        sum += r;
      }
      const mean = sum / lookback;
      for (let k = i - lookback; k < i; k++) {
        const r = retJpCC[k].values[j];
        varSum += Math.pow(r - mean, 2);
      }
      volatilities[j] = Math.sqrt(varSum / lookback);
    }
    
    // リスクパリティ重み（ボラティリティの逆数）
    const invVol = volatilities.map(v => v > 0 ? 1 / v : 0);
    const sumInvVol = invVol.reduce((a, b) => a + b, 0);
    const weights = sumInvVol > 0 ? invVol.map(w => w / sumInvVol) : new Array(n).fill(1 / n);
    
    // 当日の OC リターンを使用
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// ============================================================================
// 戦略 4: 最小分散ポートフォリオ
// ============================================================================
function minimumVarianceStrategy(retJpCC, retJpOc, lookback = 60) {
  const n = retJpCC[0].values.length;
  const returns = [];
  
  for (let i = lookback; i < retJpCC.length; i++) {
    // 分散の逆数で重み付け
    const variances = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      let sum = 0;
      let varSum = 0;
      for (let k = i - lookback; k < i; k++) {
        const r = retJpCC[k].values[j];
        sum += r;
      }
      const mean = sum / lookback;
      for (let k = i - lookback; k < i; k++) {
        const r = retJpCC[k].values[j];
        varSum += Math.pow(r - mean, 2);
      }
      variances[j] = varSum / lookback;
    }
    
    const invVar = variances.map(v => v > 0 ? 1 / v : 0);
    const sumInvVar = invVar.reduce((a, b) => a + b, 0);
    const weights = sumInvVar > 0 ? invVar.map(w => w / sumInvVar) : new Array(n).fill(1 / n);
    
    // 当日の OC リターンを使用
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// ============================================================================
// 戦略 5: 業種ローテーション
// ============================================================================
function sectorRotationStrategy(retJpCC, retJpOc, momentumWindow = 63, reversalWindow = 21) {
  const n = retJpCC[0].values.length;
  const returns = [];
  
  // 業種分類（簡易版）
  const cyclicalSectors = [0, 1, 3, 4, 7]; // 素材、通信、金融、産業、不動産
  const defensiveSectors = [2, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16]; // その他
  
  for (let i = Math.max(momentumWindow, reversalWindow); i < retJpCC.length; i++) {
    // 中長期モメンタム（3 ヶ月）
    const momentum3M = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let k = i - momentumWindow; k < i; k++) {
        momentum3M[j] += retJpCC[k].values[j];
      }
    }
    
    // 短期リバース（1 ヶ月）
    const reversal1M = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let k = i - reversalWindow; k < i; k++) {
        reversal1M[j] -= retJpCC[k].values[j];
      }
    }
    
    // 複合スコア
    const scores = momentum3M.map((m, j) => m * 0.7 + reversal1M[j] * 0.3);
    
    // サイクリカルとディフェンシブで分別
    const cyclicalScores = cyclicalSectors.map(idx => ({ idx, score: scores[idx] }));
    const defensiveScores = defensiveSectors.map(idx => ({ idx, score: scores[idx] }));
    
    // それぞれのトップを選択
    const topCyclical = cyclicalScores.sort((a, b) => b.score - a.score).slice(0, 3);
    const topDefensive = defensiveScores.sort((a, b) => b.score - a.score).slice(0, 2);
    
    const weights = new Array(n).fill(0);
    const cyclicalWeight = 0.6 / topCyclical.length;
    const defensiveWeight = 0.4 / topDefensive.length;
    
    for (const { idx } of topCyclical) weights[idx] = cyclicalWeight;
    for (const { idx } of topDefensive) weights[idx] = defensiveWeight;
    
    // 当日の OC リターンを使用
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// ============================================================================
// メイン処理
// ============================================================================
async function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
  
  console.log('リターン行列構築中...');
  const { retUs, retJpCC, retJpOc, dates } = buildReturnMatrices(usData, jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);
  
  console.log('\n戦略バックテスト中...');
  
  // 各戦略を実行
  const strategies = {
    '単純モメンタム (20 日)': () => simpleMomentumStrategy(retJpCC, retJpOc, 20, 0.3),
    '単純モメンタム (60 日)': () => simpleMomentumStrategy(retJpCC, retJpOc, 60, 0.3),
    '平均回帰 (20 日)': () => meanReversionStrategy(retJpCC, retJpOc, 20, 0.3),
    '平均回帰 (60 日)': () => meanReversionStrategy(retJpCC, retJpOc, 60, 0.3),
    'リスクパリティ (60 日)': () => riskParityStrategy(retJpCC, retJpOc, 60),
    '最小分散 (60 日)': () => minimumVarianceStrategy(retJpCC, retJpOc, 60),
    '業種ローテーション': () => sectorRotationStrategy(retJpCC, retJpOc, 63, 21)
  };
  
  const results = {};
  
  for (const [name, strategyFn] of Object.entries(strategies)) {
    console.log(`  ${name}...`);
    const returns = strategyFn();
    const metrics = computePerformanceMetrics(returns, 252);
    
    results[name] = {
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      RR: metrics.RR || 0,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100,
      winRate: (returns.filter(r => r > 0).length / returns.length) * 100,
      days: returns.length
    };
  }
  
  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('戦略比較結果');
  console.log('='.repeat(80));
  
  console.log('\nシャープレシオ順（上位 5 戦略）:');
  const sortedBySharpe = Object.entries(results)
    .sort((a, b) => b[1].RR - a[1].RR)
    .slice(0, 5);
  
  console.log('\nRank  戦略名                        SR      AR(%)   R/R    MDD(%)   勝率 (%)');
  console.log('-'.repeat(80));
  
  sortedBySharpe.forEach(([name, metrics], i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${name.padEnd(28)}  ` +
      `${String(metrics.RR.toFixed(2)).padStart(6)}  ` +
      `${String(metrics.AR.toFixed(2)).padStart(7)}  ` +
      `${String(metrics.RR.toFixed(2)).padStart(6)}  ` +
      `${String(metrics.MDD.toFixed(2)).padStart(8)}  ` +
      `${String(metrics.winRate.toFixed(1)).padStart(8)}`
    );
  });
  
  // 推奨戦略
  console.log('\n' + '='.repeat(80));
  console.log('推奨戦略');
  console.log('='.repeat(80));
  
  const bestStrategy = sortedBySharpe[0];
  console.log(`\n🏆 最適戦略：${bestStrategy[0]}`);
  console.log(`   シャープレシオ：${bestStrategy[1].RR.toFixed(2)}`);
  console.log(`   年率リターン：${bestStrategy[1].AR.toFixed(2)}%`);
  console.log(`   最大ドローダウン：${bestStrategy[1].MDD.toFixed(2)}%`);
  console.log(`   勝率：${bestStrategy[1].winRate.toFixed(1)}%`);
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'alternative_strategies_comparison.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: {
      start: dates[0],
      end: dates[dates.length - 1],
      totalDays: dates.length
    },
    strategies: results,
    ranking: sortedBySharpe.map(([name, metrics]) => ({
      rank: results[name].RR,
      name,
      ...metrics
    })),
    recommendation: {
      strategy: bestStrategy[0],
      metrics: bestStrategy[1]
    }
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('次のステップ');
  console.log('='.repeat(80));
  console.log('1. 推奨戦略の詳細バックテストを実行');
  console.log('2. 既存の PCA 戦略との組み合わせを検討');
  console.log('3. パラメータ最適化を実施');
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
