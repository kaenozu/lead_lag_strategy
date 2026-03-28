/**
 * 長期バックテストスクリプト
 * 全期間（2018-2025）のバックテストを実行し、詳細レポートを生成
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');

const WINDOW_LENGTH = 60;
const N_FACTORS = 3;
const LAMBDA_REG = 0.80;
const QUANTILE = 0.45;

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('長期バックテスト - 全期間（2018-2025）');
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
        return { date, open: +open, high: +high, low: +low, close: +close };
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
  const retJp = [];
  const retJpOc = [];

  const allDates = new Set();
  Object.values(usData).forEach(d => d.forEach(r => allDates.add(r.date)));
  Object.values(jpData).forEach(d => d.forEach(r => allDates.add(r.date)));

  const sortedDates = Array.from(allDates).sort();

  for (const date of sortedDates) {
    const usReturns = [];
    const jpReturns = [];
    const jpOcReturns = [];

    for (const ticker of US_ETF_TICKERS) {
      const prev = usData[ticker]?.find(r => r.date < date);
      const curr = usData[ticker]?.find(r => r.date === date);
      if (prev && curr) {
        usReturns.push((curr.close - prev.close) / prev.close);
      }
    }

    for (const ticker of JP_ETF_TICKERS) {
      const prevClose = jpData[ticker]?.find(r => r.date < date);
      const curr = jpData[ticker]?.find(r => r.date === date);
      if (prevClose && curr) {
        jpReturns.push((curr.close - prevClose.close) / prevClose.close);
        jpOcReturns.push((curr.close - curr.open) / curr.open);
      }
    }

    if (usReturns.length === US_ETF_TICKERS.length && 
        jpReturns.length === JP_ETF_TICKERS.length) {
      dates.push(date);
      retUs.push({ date, values: usReturns });
      retJp.push({ date, values: jpReturns });
      retJpOc.push({ date, values: jpOcReturns });
    }
  }

  return { retUs, retJp, retJpOc, dates };
}

function runBacktest(retUs, retJp, retJpOc, sectorLabels, CFull) {
  const signalGen = new LeadLagSignal({
    lambdaReg: LAMBDA_REG,
    nFactors: N_FACTORS,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const strategyReturns = [];
  const dates = [];
  const dailyReturns = [];
  let prevWeights = null;

  for (let i = WINDOW_LENGTH; i < retJpOc.length; i++) {
    const windowStart = i - WINDOW_LENGTH;
    const retUsWindow = retUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = retJp.slice(windowStart, i).map(r => r.values);
    const retUsLatest = retUs[i - 1].values;

    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      sectorLabels,
      CFull
    );

    const weights = buildPortfolio(signal, QUANTILE);

    // シグナル平滑化
    const smoothingAlpha = 0.3;
    if (prevWeights) {
      for (let j = 0; j < weights.length; j++) {
        weights[j] = smoothingAlpha * weights[j] + (1 - smoothingAlpha) * prevWeights[j];
      }
    }

    const retOc = retJpOc[i].values;
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      portfolioReturn += weights[j] * retOc[j];
    }

    prevWeights = [...weights];

    strategyReturns.push({
      date: retJpOc[i].date,
      return: portfolioReturn
    });
    dates.push(retJpOc[i].date);
    dailyReturns.push(portfolioReturn);
  }

  return { strategyReturns, dates, dailyReturns };
}

function analyzeYearlyPerformance(strategyReturns) {
  const yearlyStats = {};
  
  for (const r of strategyReturns) {
    const year = r.date.split('-')[0];
    if (!yearlyStats[year]) {
      yearlyStats[year] = [];
    }
    yearlyStats[year].push(r.return);
  }

  const results = [];
  for (const [year, returns] of Object.entries(yearlyStats).sort()) {
    const metrics = computePerformanceMetrics(returns, 252);
    results.push({
      year,
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      RR: metrics.RR,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100
    });
  }

  return results;
}

function analyzeQuarterlyPerformance(strategyReturns) {
  const quarterlyStats = {};
  
  for (const r of strategyReturns) {
    const date = new Date(r.date);
    const year = date.getFullYear();
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    const key = `${year}-Q${quarter}`;
    
    if (!quarterlyStats[key]) {
      quarterlyStats[key] = [];
    }
    quarterlyStats[key].push(r.return);
  }

  const results = [];
  for (const [period, returns] of Object.entries(quarterlyStats).sort()) {
    const metrics = computePerformanceMetrics(returns, 252);
    results.push({
      period,
      AR: metrics.AR * 100,
      RISK: metrics.RISK * 100,
      RR: metrics.RR,
      MDD: metrics.MDD * 100,
      cumulative: (metrics.Cumulative - 1) * 100
    });
  }

  return results;
}

function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  const usCount = Object.values(usData).reduce((sum, d) => sum + d.length, 0);
  const jpCount = Object.values(jpData).reduce((sum, d) => sum + d.length, 0);
  console.log(`  米国データ：${usCount}件`);
  console.log(`  日本データ：${jpCount}件`);

  console.log('\nリターン行列構築中...');
  const { retUs, retJp, retJpOc, dates } = buildReturnMatrices(usData, jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  console.log('\n相関行列計算中...');
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  console.log(`  相関行列：${CFull.length}x${CFull[0].length}`);

  console.log('\nバックテスト実行中...');
  const { strategyReturns, dates: retDates, dailyReturns } = runBacktest(
    retUs, retJp, retJpOc, config.sectorLabels, CFull
  );
  console.log(`  完了：${strategyReturns.length}日分`);

  // 全体パフォーマンス
  console.log('\n' + '='.repeat(80));
  console.log('全体パフォーマンス');
  console.log('='.repeat(80));
  
  const totalMetrics = computePerformanceMetrics(dailyReturns, 252);
  console.log(`  期間：${retDates[0]} ~ ${retDates[retDates.length - 1]}`);
  console.log(`  取引日数：${dailyReturns.length}日`);
  console.log(`  年率リターン (AR): ${(totalMetrics.AR * 100).toFixed(2)}%`);
  console.log(`  年率リスク (RISK): ${(totalMetrics.RISK * 100).toFixed(2)}%`);
  console.log(`  リスク・リターン比 (R/R): ${(totalMetrics.RR || 0).toFixed(2)}`);
  console.log(`  シャープレシオ： ${(totalMetrics.RR || 0).toFixed(2)}`);
  console.log(`  最大ドローダウン (MDD): ${(totalMetrics.MDD * 100).toFixed(2)}%`);
  console.log(`  累積リターン： ${((totalMetrics.Cumulative - 1) * 100).toFixed(2)}%`);
  console.log(`  勝率： ${((dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100).toFixed(1)}%`);

  // 年別パフォーマンス
  console.log('\n' + '='.repeat(80));
  console.log('年別パフォーマンス');
  console.log('='.repeat(80));
  
  const yearlyStats = analyzeYearlyPerformance(strategyReturns);
  console.log('Year        AR (%)     R/R    MDD (%)   Cumulative (%)');
  console.log('-'.repeat(65));
  for (const stat of yearlyStats) {
    console.log(`${stat.year}  ${String(stat.AR.toFixed(2)).padStart(9)}  ${String(stat.RR.toFixed(2)).padStart(7)}  ${String(stat.MDD.toFixed(2)).padStart(9)}  ${String(stat.cumulative.toFixed(2)).padStart(15)}`);
  }

  // 四半期別パフォーマンス
  console.log('\n' + '='.repeat(80));
  console.log('四半期別パフォーマンス');
  console.log('='.repeat(80));
  
  const quarterlyStats = analyzeQuarterlyPerformance(strategyReturns);
  console.log('Period      AR (%)     R/R    MDD (%)   Cumulative (%)');
  console.log('-'.repeat(65));
  for (const stat of quarterlyStats.slice(-12)) { // 直近 12 四半期
    console.log(`${stat.period}  ${String(stat.AR.toFixed(2)).padStart(9)}  ${String(stat.RR.toFixed(2)).padStart(7)}  ${String(stat.MDD.toFixed(2)).padStart(9)}  ${String(stat.cumulative.toFixed(2)).padStart(15)}`);
  }

  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const reportPath = path.join(outputDir, 'long_term_backtest_report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    period: {
      start: retDates[0],
      end: retDates[retDates.length - 1],
      totalDays: dailyReturns.length
    },
    overallMetrics: {
      AR: totalMetrics.AR * 100,
      RISK: totalMetrics.RISK * 100,
      RR: totalMetrics.RR || 0,
      MDD: totalMetrics.MDD * 100,
      cumulative: (totalMetrics.Cumulative - 1) * 100,
      winRate: (dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100
    },
    yearlyPerformance: yearlyStats,
    quarterlyPerformance: quarterlyStats,
    parameters: {
      windowLength: WINDOW_LENGTH,
      nFactors: N_FACTORS,
      lambdaReg: LAMBDA_REG,
      quantile: QUANTILE
    }
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n💾 レポートを保存しました：${reportPath}`);

  // 評価
  console.log('\n' + '='.repeat(80));
  console.log('戦略評価');
  console.log('='.repeat(80));

  const issues = [];
  if (totalMetrics.RR < 0) issues.push('シャープレシオがマイナス');
  if (totalMetrics.MDD > 0.2) issues.push('最大ドローダウンが 20% 超');
  if (totalMetrics.AR < 0) issues.push('年率リターンがマイナス');

  if (issues.length === 0) {
    console.log('  ✅ 良好：全ての指標が基準をクリア');
  } else {
    console.log('  ⚠️  改善が必要:');
    issues.forEach(issue => console.log(`    - ${issue}`));
  }

  console.log('\n  推奨アクション:');
  if (totalMetrics.RR < 0) {
    console.log('    1. 為替ヘッジの導入（USD/JPY ファクター）');
    console.log('    2. 市場環境フィルタの追加（VIX、金利）');
    console.log('    3. マルチファクターモデルの検討');
  } else {
    console.log('    1. 実運用に向けた準備');
    console.log('    2. リスク管理パラメータの最終調整');
  }
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
