/**
 * ハイブリッド戦略 - PCA + 平均回帰
 * 複数戦略のシグナルを統合
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const { computePerformanceMetrics } = require('../lib/portfolio');

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('ハイブリッド戦略 - PCA + 平均回帰');
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

function buildReturnMatrices(usData, jpData) {
  const dates = [];
  const retUs = [];
  const retJpCC = [];
  const retJpOc = [];

  const allDates = new Set();
  Object.values(usData).forEach(d => d.forEach(r => allDates.add(r.date)));
  Object.values(jpData).forEach(d => d.forEach(r => allDates.add(r.date)));

  const sortedDates = Array.from(allDates).sort();

  for (const date of sortedDates) {
    const usReturns = [];
    const jpCcReturns = [];
    const jpOcReturns = [];

    for (const ticker of US_ETF_TICKERS) {
      const prev = findPrevEntry(usData[ticker], date);
      const curr = usData[ticker]?.find(r => r.date === date);
      if (prev && curr) {
        usReturns.push((curr.close - prev.close) / prev.close);
      }
    }

    for (const ticker of JP_ETF_TICKERS) {
      const prevClose = findPrevEntry(jpData[ticker], date);
      const curr = jpData[ticker]?.find(r => r.date === date);
      if (prevClose && curr) {
        jpCcReturns.push((curr.close - prevClose.close) / prevClose.close);
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

// PCA 戦略シグナル
function pcaSignal(retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull, params) {
  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg || 0.8,
    nFactors: params.nFactors || 3,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  return signalGen.computeSignal(
    retUsWindow,
    retJpWindow,
    retUsLatest,
    sectorLabels,
    CFull
  );
}

// 平均回帰シグナル
function meanReversionSignal(retJpWindow, _lookback = 20) {
  const n = retJpWindow[0].length;
  const mean = new Array(n).fill(0);
  const std = new Array(n).fill(0);
  
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let k = 0; k < retJpWindow.length; k++) {
      sum += retJpWindow[k][j];
    }
    mean[j] = sum / retJpWindow.length;
    
    let varSum = 0;
    for (let k = 0; k < retJpWindow.length; k++) {
      varSum += Math.pow(retJpWindow[k][j] - mean[j], 2);
    }
    std[j] = Math.sqrt(varSum / retJpWindow.length);
  }
  
  // Z スコア（負の値がアンダーパフォーム＝ロングシグナル）
  return mean.map((m, j) => std[j] > 0 ? -m / std[j] : 0);
}

// シグナル統合方法
function combineSignals(pcaSig, mrSig, method, pcaWeight = 0.5) {
  const n = pcaSig.length;
  const combined = new Array(n).fill(0);
  
  if (method === 'weighted') {
    // 加重平均
    for (let i = 0; i < n; i++) {
      combined[i] = pcaSig[i] * pcaWeight + mrSig[i] * (1 - pcaWeight);
    }
  } else if (method === 'voting') {
    // 投票（符号が一致したら強シグナル）
    for (let i = 0; i < n; i++) {
      const pcaSign = Math.sign(pcaSig[i]);
      const mrSign = Math.sign(mrSig[i]);
      
      if (pcaSign === mrSign) {
        // 一致：強シグナル
        combined[i] = (Math.abs(pcaSig[i]) + Math.abs(mrSig[i])) / 2 * pcaSign;
      } else {
        // 不一致：加重平均（単純平均だとキャンセルされるのを防ぐ）
        combined[i] = pcaSig[i] * pcaWeight + mrSig[i] * (1 - pcaWeight);
      }
    }
  } else if (method === 'max') {
    // 絶対値の大きい方を採用
    for (let i = 0; i < n; i++) {
      if (Math.abs(pcaSig[i]) >= Math.abs(mrSig[i])) {
        combined[i] = pcaSig[i];
      } else {
        combined[i] = mrSig[i];
      }
    }
  } else {
    // 単純平均
    for (let i = 0; i < n; i++) {
      combined[i] = (pcaSig[i] + mrSig[i]) / 2;
    }
  }
  
  return combined;
}

// ポートフォリオ構築
function buildPortfolioFromSignal(signal, quantile = 0.3) {
  const n = signal.length;
  const q = Math.max(1, Math.floor(n * quantile));
  
  const ranked = signal.map((val, idx) => ({ val, idx }))
    .sort((a, b) => a.val - b.val);
  
  const longIndices = ranked.slice(-q).map(x => x.idx);
  const shortIndices = ranked.slice(0, q).map(x => x.idx);
  
  const weights = new Array(n).fill(0);
  const longWeight = 1.0 / q;
  const shortWeight = -1.0 / q;
  
  for (const idx of longIndices) weights[idx] = longWeight;
  for (const idx of shortIndices) weights[idx] = shortWeight;
  
  return weights;
}

// ハイブリッド戦略バックテスト
function hybridBacktest(retUs, retJpCC, retJpOc, params) {
  const n = retJpCC[0].values.length;
  const returns = [];
  
  const windowLength = params.windowLength || 60;
  const sectorLabels = config.sectorLabels;
  
  // 相関行列（事前計算）
  const combined = retUs.map((r, i) => [...r.values, ...retJpCC[i].values]);
  const CFull = correlationMatrixSample(combined);
  
  for (let i = windowLength; i < retJpCC.length; i++) {
    const windowStart = i - windowLength;
    const retUsWindow = retUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = retJpCC.slice(windowStart, i).map(r => r.values);
    const retUsLatest = retUs[i - 1].values;
    
    // 各戦略のシグナル計算
    const pcaSig = pcaSignal(retUsWindow, retJpWindow, retUsLatest, sectorLabels, CFull, params);
    const mrSig = meanReversionSignal(retJpWindow, params.mrLookback || 20);
    
    // シグナル統合
    const combinedSig = combineSignals(
      pcaSig, 
      mrSig, 
      params.combinationMethod || 'average',
      params.pcaWeight || 0.5
    );
    
    // ポートフォリオ構築
    const weights = buildPortfolioFromSignal(combinedSig, params.quantile || 0.3);
    
    // リターン計算
    let portfolioReturn = 0;
    for (let j = 0; j < n; j++) {
      portfolioReturn += weights[j] * retJpOc[i].values[j];
    }
    
    returns.push(portfolioReturn);
  }
  
  return returns;
}

// メイン処理
async function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);
  
  // 米国データの開始日を日本に合わせる（2018 年以降）
  // または日本データのみで平均回帰をテスト
  const { retUs, retJpCC, retJpOc, dates } = buildReturnMatrices(usData, jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);
  
  // 注：米国データが 2018 年以降しかないため、平均回帰単独は日本データのみで実行
  
  console.log('\nハイブリッド戦略バックテスト中...');
  
  // 戦略バリエーション
  const strategies = {
    'PCA 単独': { pcaWeight: 1.0, combinationMethod: 'average' },
    '平均回帰 単独': { pcaWeight: 0.0, combinationMethod: 'average' },
    'ハイブリッド (加重 50-50)': { pcaWeight: 0.5, combinationMethod: 'weighted' },
    'ハイブリッド (加重 70-30)': { pcaWeight: 0.7, combinationMethod: 'weighted' },
    'ハイブリッド (加重 30-70)': { pcaWeight: 0.3, combinationMethod: 'weighted' },
    'ハイブリッド (投票)': { pcaWeight: 0.5, combinationMethod: 'voting' },
    'ハイブリッド (Max)': { pcaWeight: 0.5, combinationMethod: 'max' },
    'ハイブリッド (平均)': { pcaWeight: 0.5, combinationMethod: 'average' }
  };
  
  const baseParams = {
    windowLength: 60,
    lambdaReg: 0.8,
    nFactors: 3,
    mrLookback: 20,
    quantile: 0.2
  };
  
  const results = {};
  
  for (const [name, hybridParams] of Object.entries(strategies)) {
    console.log(`  ${name}...`);
    
    const params = { ...baseParams, ...hybridParams };
    const returns = hybridBacktest(retUs, retJpCC, retJpOc, params);
    const metrics = computePerformanceMetrics(returns, 252);
    
    results[name] = {
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      SR: metrics.RR || 0,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100,
      winRate: (returns.filter(r => r > 0).length / returns.length) * 100,
      returns
    };
  }
  
  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('ハイブリッド戦略比較結果');
  console.log('='.repeat(80));
  
  console.log('\nシャープレシオ順:');
  const sorted = Object.entries(results)
    .sort((a, b) => b[1].SR - a[1].SR);
  
  console.log('\n戦略名                           SR      AR(%)   RISK(%)  MDD(%)   勝率 (%)');
  console.log('-'.repeat(80));
  
  sorted.forEach(([name, metrics]) => {
    console.log(
      `${name.padEnd(32)}  ${String(metrics.SR.toFixed(2)).padStart(6)}  ` +
      `${String(metrics.AR.toFixed(2)).padStart(7)}  ${String(metrics.RISK.toFixed(2)).padStart(7)}  ` +
      `${String(metrics.MDD.toFixed(2)).padStart(8)}  ${String(metrics.winRate.toFixed(1)).padStart(8)}`
    );
  });
  
  // 最適パラメータの深堀り
  console.log('\n' + '='.repeat(80));
  console.log('最適パラメータの深堀り');
  console.log('='.repeat(80));
  
  const bestName = sorted[0][0];
  const bestParams = strategies[bestName];
  
  // PCA 重みパラメータグリッド
  if (bestName.includes('加重')) {
    console.log('\nPCA 重みパラメータの感応度分析:');
    
    const weightGrid = [0.0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0];
    const weightResults = [];
    
    for (const weight of weightGrid) {
      const params = { 
        ...baseParams, 
        pcaWeight: weight, 
        combinationMethod: 'weighted' 
      };
      const returns = hybridBacktest(retUs, retJpCC, retJpOc, params);
      const metrics = computePerformanceMetrics(returns, 252);
      
      weightResults.push({
        weight,
        SR: metrics.RR || 0,
        AR: metrics.AR * 100,
        MDD: metrics.MDD * 100
      });
    }
    
    console.log('PCA 重み   SR      AR(%)   MDD(%)');
    console.log('-'.repeat(40));
    weightResults.forEach(r => {
      console.log(
        `${r.weight.toFixed(1).padStart(7)}  ${String(r.SR.toFixed(2)).padStart(6)}  ` +
        `${String(r.AR.toFixed(2)).padStart(7)}  ${String(r.MDD.toFixed(2)).padStart(8)}`
      );
    });
  }
  
  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, 'hybrid_strategy_comparison.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: {
      start: dates[0],
      end: dates[dates.length - 1],
      totalDays: dates.length
    },
    baseParameters: baseParams,
    strategies: Object.entries(results).map(([name, m]) => ({
      name,
      AR: m.AR,
      RISK: m.RISK,
      SR: m.SR,
      MDD: m.MDD,
      cumulative: m.cumulative,
      winRate: m.winRate
    })),
    ranking: sorted.map(([name], i) => ({
      rank: i + 1,
      name,
      SR: results[name].SR
    })),
    recommendation: {
      strategy: bestName,
      parameters: {
        ...baseParams,
        ...bestParams
      },
      metrics: results[bestName]
    }
  }, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
  
  // 推奨戦略
  const best = sorted[0][1];
  
  console.log('\n' + '='.repeat(80));
  console.log('推奨戦略');
  console.log('='.repeat(80));
  
  console.log(`\n🏆 最適戦略：${bestName}`);
  console.log(`   シャープレシオ：${best.SR.toFixed(2)}`);
  console.log(`   年率リターン：${best.AR.toFixed(2)}%`);
  console.log(`   年率リスク：${best.RISK.toFixed(2)}%`);
  console.log(`   最大ドローダウン：${best.MDD.toFixed(2)}%`);
  console.log(`   勝率：${best.winRate.toFixed(1)}%`);
  
  // 単独戦略との比較
  const pcaOnly = results['PCA 単独'];
  const mrOnly = results['平均回帰 単独'];
  
  console.log('\n  単独戦略との比較:');
  console.log(`    PCA 単独：SR=${pcaOnly.SR.toFixed(2)}, AR=${pcaOnly.AR.toFixed(2)}%`);
  console.log(`    平均回帰単独：SR=${mrOnly.SR.toFixed(2)}, AR=${mrOnly.AR.toFixed(2)}%`);
  console.log(`    ハイブリッド：SR=${best.SR.toFixed(2)}, AR=${best.AR.toFixed(2)}%`);
  
  const srImprovementVsPca = ((best.SR - pcaOnly.SR) / Math.abs(pcaOnly.SR) * 100);
  const srImprovementVsMr = ((best.SR - mrOnly.SR) / Math.abs(mrOnly.SR) * 100);
  
  console.log('\n  改善幅:');
  console.log(`    vs PCA: ${srImprovementVsPca > 0 ? '+' : ''}${srImprovementVsPca.toFixed(1)}%`);
  console.log(`    vs 平均回帰：${srImprovementVsMr > 0 ? '+' : ''}${srImprovementVsMr.toFixed(1)}%`);
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
