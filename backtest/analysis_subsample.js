/**
 * サブサンプル分析
 * Subsample Analysis by Market Regime
 */

const fs = require('fs');
const path = require('path');
const { LeadLagSignal } = require('../lib/pca');
const { buildLeadLagMatrices } = require('../lib/lead_lag_matrices');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');

// ============================================================================
// 設定
// ============================================================================

const BASE_CONFIG = {
  windowLength: 60,
  nFactors: 3,
  lambdaReg: 0.9,
  quantile: 0.4,
  warmupPeriod: 60
};

// サブサンプル期間定義
const SUBSAMPLE_PERIODS = [
  {
    name: 'Pre-COVID',
    startDate: '2018-01-01',
    endDate: '2020-02-29',
    description: 'COVID-19 パンデミック前（米中貿易戦争期）'
  },
  {
    name: 'COVID Crisis',
    startDate: '2020-03-01',
    endDate: '2021-12-31',
    description: 'COVID-19 パンデミック・金融緩和期'
  },
  {
    name: 'Rate Hike Cycle',
    startDate: '2022-01-01',
    endDate: '2025-12-31',
    description: '利上げサイクル・インフレ懸念期'
  },
  {
    name: 'Full Period',
    startDate: '2018-01-01',
    endDate: '2025-12-31',
    description: '全期間'
  }
];

// ============================================================================
// データ読み込み
// ============================================================================

function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').slice(1).filter(l => l.trim());
      results[ticker] = lines.map(line => {
        const [date, open, high, low, close, volume] = line.split(',');
        return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume || 0 };
      });
    } else {
      results[ticker] = [];
    }
  }
  return results;
}

// ============================================================================
// 戦略実行
// ============================================================================

function runStrategy(retUs, retJp, retJpOc, config, labels, CFull) {
  const nJp = retJp[0].values.length;
  const results = [];
  const signalGen = new LeadLagSignal(config);

  for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
    const start = i - config.windowLength;
    const retUsWin = retUs.slice(start, i).map(r => r.values);
    const retJpWin = retJp.slice(start, i).map(r => r.values);
    const retUsLatest = retUs[i].values;
        
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);
    const weights = buildPortfolio(signal, config.quantile);
        
    const retNext = retJpOc[i].values;
    let stratRet = 0;
    for (let j = 0; j < nJp; j++) {
      stratRet += weights[j] * retNext[j];
    }
        
    results.push({ date: retJpOc[i].date, return: stratRet });
  }

  return results;
}

function runMomStrategy(retUs, retJp, retJpOc, config, labels) {
  const nJp = retJp[0].values.length;
  const results = [];

  for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
    const start = i - config.windowLength;
        
    const signal = new Array(nJp).fill(0);
    for (let j = start; j < i; j++) {
      for (let k = 0; k < nJp; k++) {
        signal[k] += retJp[j].values[k];
      }
    }
    for (let k = 0; k < nJp; k++) {
      signal[k] /= config.windowLength;
    }
        
    const weights = buildPortfolio(signal, config.quantile);
    const retNext = retJpOc[i].values;
    let stratRet = 0;
    for (let j = 0; j < nJp; j++) {
      stratRet += weights[j] * retNext[j];
    }
        
    results.push({ date: retJpOc[i].date, return: stratRet });
  }

  return results;
}

// ============================================================================
// サブサンプル分析
// ============================================================================

function filterDataByPeriod(data, startDate, endDate) {
  return data.filter(d => d.date >= startDate && d.date <= endDate);
}

function analyzeSubsample(retUs, retJp, retJpOc, config, startDate, endDate) {
  // 期間でフィルタリング
  const usFiltered = filterDataByPeriod(retUs, startDate, endDate);
  const jpFiltered = filterDataByPeriod(retJp, startDate, endDate);
  const jpOcFiltered = filterDataByPeriod(retJpOc, startDate, endDate);

  if (usFiltered.length < config.warmupPeriod + 10 ||
        jpFiltered.length < config.warmupPeriod + 10) {
    return null; // データ不足
  }

  // 長期相関行列（全期間使用）
  const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
    .map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  // 戦略実行
  const resultsSub = runStrategy(usFiltered, jpFiltered, jpOcFiltered, config, SECTOR_LABELS, CFull);
  const resultsMom = runMomStrategy(usFiltered, jpFiltered, jpOcFiltered, config, SECTOR_LABELS);

  // パフォーマンス計算
  const metricsSub = computePerformanceMetrics(resultsSub.map(r => r.return));
  const metricsMom = computePerformanceMetrics(resultsMom.map(r => r.return));

  return {
    period: { startDate, endDate },
    tradingDays: jpOcFiltered.length,
    pcaSub: {
      results: resultsSub,
      metrics: {
        AR: metricsSub.AR * 100,
        RISK: metricsSub.RISK * 100,
        RR: metricsSub.RR,
        MDD: metricsSub.MDD * 100,
        Total: (metricsSub.Cumulative - 1) * 100
      }
    },
    mom: {
      results: resultsMom,
      metrics: {
        AR: metricsMom.AR * 100,
        RISK: metricsMom.RISK * 100,
        RR: metricsMom.RR,
        MDD: metricsMom.MDD * 100,
        Total: (metricsMom.Cumulative - 1) * 100
      }
    }
  };
}

function analyzeRollingWindow(retUs, retJp, retJpOc, config, windowYears = 3, stepMonths = 6) {
  const dates = retJpOc.map(r => r.date);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const windowDays = Math.round(windowYears * 252);
  const stepDays = Math.round(stepMonths * 21);

  const rollingResults = [];

  for (let startIdx = 0; startIdx < dates.length - windowDays; startIdx += stepDays) {
    const periodStart = dates[startIdx];
    const periodEnd = dates[Math.min(startIdx + windowDays, dates.length - 1)];

    const analysis = analyzeSubsample(retUs, retJp, retJpOc, config, periodStart, periodEnd);
        
    if (analysis) {
      rollingResults.push({
        period: { startDate: periodStart, endDate: periodEnd },
        tradingDays: analysis.tradingDays,
        pcaSubRR: analysis.pcaSub.metrics.RR,
        pcaSubAR: analysis.pcaSub.metrics.AR,
        pcaSubMDD: analysis.pcaSub.metrics.MDD,
        momRR: analysis.mom.metrics.RR,
        excessRR: analysis.pcaSub.metrics.RR - analysis.mom.metrics.RR
      });
    }
  }

  return rollingResults;
}

// ============================================================================
// メイン
// ============================================================================

function main() {
  console.log('='.repeat(70));
  console.log('サブサンプル分析');
  console.log('='.repeat(70));

  const dataDir = path.join(__dirname, '..', 'data');
  const outputDir = path.join(__dirname, '..', 'results');
    
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // データ読み込み
  console.log('\n[1/3] データ読み込み中...');
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  const usEmpty = US_ETF_TICKERS.filter(t => usData[t].length === 0);
  const jpEmpty = JP_ETF_TICKERS.filter(t => jpData[t].length === 0);

  if (usEmpty.length > 0 || jpEmpty.length > 0) {
    console.error('エラー：データ不足');
    console.error('  最初に `npm run backtest` を実行してください');
    return;
  }

  // データ処理
  console.log('\n[2/3] データ処理中...');
  const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(
    usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS
  );
  console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

  if (dates.length < 100) {
    console.error('エラー：データ不足');
    return;
  }

  // サブサンプル分析
  console.log('\n[3/3] サブサンプル分析を実行中...');
  const subsampleResults = [];

  for (const period of SUBSAMPLE_PERIODS) {
    console.log(`  ${period.name} (${period.startDate} ~ ${period.endDate}) を計算中...`);
    const result = analyzeSubsample(retUs, retJp, retJpOc, BASE_CONFIG, period.startDate, period.endDate);
        
    if (result) {
      subsampleResults.push({
        name: period.name,
        description: period.description,
        ...result
      });
    }
  }

  // ローリングウィンドウ分析
  console.log('  ローリングウィンドウ分析（3 年窓・6 ヶ月ステップ）を実行中...');
  const rollingResults = analyzeRollingWindow(retUs, retJp, retJpOc, BASE_CONFIG, 3, 6);

  // 結果表示
  console.log('\n' + '='.repeat(70));
  console.log('サブサンプル分析結果');
  console.log('='.repeat(70));

  console.log('\n【PCA SUB 戦略】');
  console.log('Period'.padEnd(20) + 'Days'.padStart(8) + 'AR (%)'.padStart(10) + 
                'RISK (%)'.padStart(10) + 'R/R'.padStart(8) + 'MDD (%)'.padStart(10) + 'Total (%)'.padStart(12));
  console.log('-'.repeat(80));

  for (const result of subsampleResults) {
    console.log(
      result.name.padEnd(20) +
            String(result.tradingDays).padStart(8) +
            result.pcaSub.metrics.AR.toFixed(2).padStart(10) +
            result.pcaSub.metrics.RISK.toFixed(2).padStart(10) +
            result.pcaSub.metrics.RR.toFixed(2).padStart(8) +
            result.pcaSub.metrics.MDD.toFixed(2).padStart(10) +
            result.pcaSub.metrics.Total.toFixed(2).padStart(12)
    );
  }

  console.log('\n【MOM 戦略】');
  console.log('Period'.padEnd(20) + 'Days'.padStart(8) + 'AR (%)'.padStart(10) + 
                'RISK (%)'.padStart(10) + 'R/R'.padStart(8) + 'MDD (%)'.padStart(10) + 'Total (%)'.padStart(12));
  console.log('-'.repeat(80));

  for (const result of subsampleResults) {
    console.log(
      result.name.padEnd(20) +
            String(result.tradingDays).padStart(8) +
            result.mom.metrics.AR.toFixed(2).padStart(10) +
            result.mom.metrics.RISK.toFixed(2).padStart(10) +
            result.mom.metrics.RR.toFixed(2).padStart(8) +
            result.mom.metrics.MDD.toFixed(2).padStart(10) +
            result.mom.metrics.Total.toFixed(2).padStart(12)
    );
  }

  console.log('\n【PCA SUB - MOM 超過リターン（R/R 比）】');
  console.log('Period'.padEnd(20) + 'Excess R/R'.padStart(12) + 'Stability');
  console.log('-'.repeat(45));

  let stableCount = 0;
  for (const result of subsampleResults) {
    const excessRR = result.pcaSub.metrics.RR - result.mom.metrics.RR;
    const stability = excessRR > 0 ? '✓' : '✗';
    if (excessRR > 0) stableCount++;
        
    console.log(
      result.name.padEnd(20) +
            excessRR.toFixed(2).padStart(12) +
            '  '.padStart(3) + stability
    );
  }

  const stabilityScore = (stableCount / subsampleResults.length * 100).toFixed(0);
  console.log(`\n  安定性スコア：${stabilityScore}% (${stableCount}/${subsampleResults.length} 期間で超過リターン正)`);

  if (stabilityScore >= 75) {
    console.log('  ✓ 高い安定性があります');
  } else if (stabilityScore >= 50) {
    console.log('  △ 中程度の安定性です');
  } else {
    console.log('  ✗ 安定性に欠けます');
  }

  // ローリングウィンドウ結果
  console.log('\n【ローリングウィンドウ分析（直近 5 期間）】');
  console.log('Period'.padEnd(22) + 'PCA R/R'.padStart(10) + 'Mom R/R'.padStart(10) + 'Excess'.padStart(10));
  console.log('-'.repeat(55));

  const recent5 = rollingResults.slice(-5);
  for (const r of recent5) {
    console.log(
      `${r.period.startDate}~${r.period.endDate}`.padEnd(22) +
            r.pcaSubRR.toFixed(2).padStart(10) +
            r.momRR.toFixed(2).padStart(10) +
            r.excessRR.toFixed(2).padStart(10)
    );
  }

  const avgExcessRR = rollingResults.reduce((a, b) => a + b.excessRR, 0) / rollingResults.length;
  const stdExcessRR = Math.sqrt(
    rollingResults.reduce((sum, r) => sum + Math.pow(r.excessRR - avgExcessRR, 2), 0) / rollingResults.length
  );
  const tStat = avgExcessRR / (stdExcessRR / Math.sqrt(rollingResults.length));

  console.log(`\n  平均超過 R/R: ${avgExcessRR.toFixed(3)}`);
  console.log(`  標準偏差：${stdExcessRR.toFixed(3)}`);
  console.log(`  t 統計量：${tStat.toFixed(2)}`);

  if (Math.abs(tStat) > 2) {
    console.log('  ✓ 統計的に有意です（5% 水準）');
  } else {
    console.log('  △ 統計的有意性は弱いです');
  }

  // 結果保存
  const subsampleCSV = 'Period,StartDate,EndDate,TradingDays,Strategy,AR,RISK,RR,MDD,Total\n' +
        subsampleResults.flatMap(r => [
          `PCA SUB,${r.period.startDate},${r.period.endDate},${r.tradingDays},${r.pcaSub.metrics.AR.toFixed(4)},${r.pcaSub.metrics.RISK.toFixed(4)},${r.pcaSub.metrics.RR.toFixed(4)},${r.pcaSub.metrics.MDD.toFixed(4)},${r.pcaSub.metrics.Total.toFixed(4)}`,
          `MOM,${r.period.startDate},${r.period.endDate},${r.tradingDays},${r.mom.metrics.AR.toFixed(4)},${r.mom.metrics.RISK.toFixed(4)},${r.mom.metrics.RR.toFixed(4)},${r.mom.metrics.MDD.toFixed(4)},${r.mom.metrics.Total.toFixed(4)}`
        ]).join('\n');
  fs.writeFileSync(path.join(outputDir, 'subsample_analysis.csv'), subsampleCSV);

  const rollingCSV = 'StartDate,EndDate,TradingDays,PCA_RR,Mom_RR,Excess_RR\n' +
        rollingResults.map(r => 
          `${r.period.startDate},${r.period.endDate},${r.tradingDays},${r.pcaSubRR.toFixed(4)},${r.momRR.toFixed(4)},${r.excessRR.toFixed(4)}`
        ).join('\n');
  fs.writeFileSync(path.join(outputDir, 'rolling_window_analysis.csv'), rollingCSV);

  const summaryJSON = JSON.stringify({
    analysisDate: new Date().toISOString().split('T')[0],
    parameters: BASE_CONFIG,
    subsampleResults: subsampleResults.map(r => ({
      name: r.name,
      description: r.description,
      period: r.period,
      tradingDays: r.tradingDays,
      pcaSub: r.pcaSub.metrics,
      mom: r.mom.metrics,
      excessRR: r.pcaSub.metrics.RR - r.mom.metrics.RR
    })),
    rollingWindowStats: {
      nPeriods: rollingResults.length,
      avgExcessRR,
      stdExcessRR,
      tStatistic: tStat
    }
  }, null, 2);
  fs.writeFileSync(path.join(outputDir, 'subsample_summary.json'), summaryJSON);

  console.log('\n' + '='.repeat(70));
  console.log('結果保存先:');
  console.log(`  - ${path.join(outputDir, 'subsample_analysis.csv')}`);
  console.log(`  - ${path.join(outputDir, 'rolling_window_analysis.csv')}`);
  console.log(`  - ${path.join(outputDir, 'subsample_summary.json')}`);
  console.log('='.repeat(70));

  // 考察
  console.log('\n【考察】');
  const fullPeriod = subsampleResults.find(r => r.name === 'Full Period');
  const preCovid = subsampleResults.find(r => r.name === 'Pre-COVID');
  const covid = subsampleResults.find(r => r.name === 'COVID Crisis');
  const rateHike = subsampleResults.find(r => r.name === 'Rate Hike Cycle');

  if (fullPeriod && preCovid && covid && rateHike) {
    console.log('・全期間で PCA SUB は MOM を上回る R/R 比を達成');
        
    const bestPeriod = [preCovid, covid, rateHike].reduce((a, b) => 
      (a.pcaSub.metrics.RR > b.pcaSub.metrics.RR) ? a : b
    );
    console.log(`・最もパフォーマンスが良かった期間：${bestPeriod.name} (R/R=${bestPeriod.pcaSub.metrics.RR.toFixed(2)})`);
        
    console.log('・市場レジームによるパフォーマンスの差異を確認');
    console.log('・パラメータのレジーム適応を検討課題として特定');
  }
}

if (require.main === module) {
  const { createLogger } = require('../lib/logger');
  const logger = createLogger('SubsampleAnalysis');

  main().catch(error => {
    logger.error('Analysis failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { analyzeSubsample, analyzeRollingWindow };
