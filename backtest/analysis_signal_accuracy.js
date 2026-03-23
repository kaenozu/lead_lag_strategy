/**
 * シグナル精度分析ツール
 * US→JP 予測精度の可視化とデバッグ
 */

const fs = require('fs');
const path = require('path');
const { LeadLagSignal } = require('../lib/pca');
const { buildLeadLagMatrices } = require('../lib/lead_lag_matrices');
const { correlationMatrixSample } = require('../lib/math');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

// ============================================================================
// 設定
// ============================================================================

const CONFIG = {
  windowLength: 60,
  nFactors: 3,
  lambdaReg: 0.9,
  quantile: 0.4,
  warmupPeriod: 60
};

// ============================================================================
// データ取得
// ============================================================================

async function fetchYahooFinanceData(ticker, startDate = '2018-01-01', endDate = '2025-12-31') {
  try {
    const result = await yahooFinance.chart(ticker, { period1: startDate, period2: endDate, interval: '1d' });
    return result.quotes
      .filter(q => q.close !== null && q.close > 0)
      .map(q => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
      }));
  } catch (e) {
    console.error(`  ${ticker} Error: ${e.message}`);
    return [];
  }
}

async function fetchAllData(tickers, startDate, endDate) {
  const results = {};
  for (const ticker of tickers) {
    results[ticker] = await fetchYahooFinanceData(ticker, startDate, endDate);
  }
  return results;
}

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
// 分析関数
// ============================================================================

/**
 * シグナル方向精度の計算
 */
function analyzeSignalAccuracy(retUs, retJp, retJpOc, config) {
  const nJp = retJp[0].values.length;
  const signalGen = new LeadLagSignal(config);
    
  // 長期相関行列
  const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
    .map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  let correct = 0;
  let total = 0;
  const accuracyBySector = new Array(nJp).fill(0).map(() => ({ correct: 0, total: 0 }));
  const monthlyAccuracy = {};

  for (let i = config.warmupPeriod; i < retJpOc.length - 1; i++) {
    const start = i - config.windowLength;
    const retUsWin = retUs.slice(start, i).map(r => r.values);
    const retJpWin = retJp.slice(start, i).map(r => r.values);
    const retUsLatest = retUs[i].values;
        
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, SECTOR_LABELS, CFull);
        
    // 実際の翌日リターン
    const actualRet = retJpOc[i + 1].values;
        
    // 方向予測の精度
    for (let j = 0; j < nJp; j++) {
      const predictedDir = Math.sign(signal[j]);
      const actualDir = Math.sign(actualRet[j]);
            
      if (predictedDir !== 0 && actualDir !== 0) {
        const isCorrect = (predictedDir === actualDir) ? 1 : 0;
        correct += isCorrect;
        total++;
                
        accuracyBySector[j].correct += isCorrect;
        accuracyBySector[j].total++;
                
        // 月別
        const month = retJpOc[i + 1].date.substring(0, 7);
        if (!monthlyAccuracy[month]) {
          monthlyAccuracy[month] = { correct: 0, total: 0 };
        }
        monthlyAccuracy[month].correct += isCorrect;
        monthlyAccuracy[month].total++;
      }
    }
  }

  // 結果集計
  const overallAccuracy = total > 0 ? correct / total : 0;
    
  const sectorAccuracy = accuracyBySector.map((s, i) => ({
    sector: JP_ETF_TICKERS[i],
    label: SECTOR_LABELS[JP_ETF_TICKERS[i]],
    accuracy: s.total > 0 ? s.correct / s.total : 0,
    samples: s.total
  }));

  const monthlyData = Object.entries(monthlyAccuracy)
    .map(([month, data]) => ({
      month,
      accuracy: data.total > 0 ? data.correct / data.total : 0,
      samples: data.total
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    overallAccuracy,
    totalSamples: total,
    sectorAccuracy,
    monthlyAccuracy: monthlyData
  };
}

/**
 * シグナルと実際のリターンの相関分析
 */
function analyzeSignalCorrelation(retUs, retJp, retJpOc, config) {
  const nJp = retJp[0].values.length;
  const signalGen = new LeadLagSignal(config);
    
  const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
    .map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  const signalSeries = [];
  const actualSeries = [];

  for (let i = config.warmupPeriod; i < retJpOc.length - 1; i++) {
    const start = i - config.windowLength;
    const retUsWin = retUs.slice(start, i).map(r => r.values);
    const retJpWin = retJp.slice(start, i).map(r => r.values);
    const retUsLatest = retUs[i].values;
        
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, SECTOR_LABELS, CFull);
    const actualRet = retJpOc[i + 1].values;
        
    signalSeries.push(signal);
    actualSeries.push(actualRet);
  }

  // 銘柄別相関
  const correlations = [];
  for (let j = 0; j < nJp; j++) {
    const signals = signalSeries.map(s => s[j]);
    const actuals = actualSeries.map(a => a[j]);
        
    const meanS = signals.reduce((a, b) => a + b, 0) / signals.length;
    const meanA = actuals.reduce((a, b) => a + b, 0) / actuals.length;
        
    let num = 0, denS = 0, denA = 0;
    for (let i = 0; i < signals.length; i++) {
      const ds = signals[i] - meanS;
      const da = actuals[i] - meanA;
      num += ds * da;
      denS += ds * ds;
      denA += da * da;
    }
        
    const corr = denS > 0 && denA > 0 ? num / Math.sqrt(denS * denA) : 0;
    correlations.push({
      sector: JP_ETF_TICKERS[j],
      label: SECTOR_LABELS[JP_ETF_TICKERS[j]],
      correlation: corr
    });
  }

  const avgCorrelation = correlations.reduce((a, b) => a + b.correlation, 0) / correlations.length;

  return {
    avgCorrelation,
    sectorCorrelations: correlations
  };
}

// ============================================================================
// メイン
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('シグナル精度分析ツール');
  console.log('='.repeat(70));

  const dataDir = path.join(__dirname, '..', 'data');
  const outputDir = path.join(__dirname, '..', 'results');
    
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // データ読み込み
  console.log('\n[1/4] データ読み込み中...');
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  const usEmpty = US_ETF_TICKERS.filter(t => usData[t].length === 0);
  const jpEmpty = JP_ETF_TICKERS.filter(t => jpData[t].length === 0);

  if (usEmpty.length > 0 || jpEmpty.length > 0) {
    console.log('  ローカルデータ不足のため、Yahoo Finance から取得...');
    const usRemote = await fetchAllData(US_ETF_TICKERS, '2018-01-01', '2025-12-31');
    const jpRemote = await fetchAllData(JP_ETF_TICKERS, '2018-01-01', '2025-12-31');
        
    for (const t of usEmpty) usData[t] = usRemote[t];
    for (const t of jpEmpty) jpData[t] = jpRemote[t];
        
    // 保存
    for (const t in usData) {
      const csv = 'Date,Open,High,Low,Close,Volume\n' + 
                usData[t].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
      fs.writeFileSync(path.join(dataDir, `${t}.csv`), csv);
    }
    for (const t in jpData) {
      const csv = 'Date,Open,High,Low,Close,Volume\n' + 
                jpData[t].map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume ?? 0}`).join('\n');
      fs.writeFileSync(path.join(dataDir, `${t}.csv`), csv);
    }
  }

  // データ処理
  console.log('\n[2/4] データ処理中...');
  const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(
    usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS
  );
  console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

  if (dates.length < 100) {
    console.error('エラー：データ不足');
    return;
  }

  // 方向精度分析
  console.log('\n[3/4] シグナル方向精度を分析中...');
  const accuracy = analyzeSignalAccuracy(retUs, retJp, retJpOc, CONFIG);

  console.log('\n' + '='.repeat(70));
  console.log('【結果 1】シグナル方向精度');
  console.log('='.repeat(70));
  console.log(`全体精度：${(accuracy.overallAccuracy * 100).toFixed(2)}% (${accuracy.totalSamples} サンプル)`);
    
  if (accuracy.overallAccuracy > 0.55) {
    console.log('✓ 良好：55% 以上の精度');
  } else if (accuracy.overallAccuracy > 0.50) {
    console.log('△ 普通：50-55% の精度（偶然レベル）');
  } else {
    console.log('✗ 不良：50% 以下の精度（偶然以下）');
  }

  console.log('\n【銘柄別精度】');
  console.log('Ticker'.padEnd(10) + 'Label'.padEnd(15) + 'Accuracy'.padStart(10) + 'Samples'.padStart(10));
  console.log('-'.repeat(45));
  for (const s of accuracy.sectorAccuracy) {
    console.log(
      s.sector.padEnd(10) +
            (s.label || 'N/A').padEnd(15) +
            `${(s.accuracy * 100).toFixed(2)}%`.padStart(10) +
            String(s.samples).padStart(10)
    );
  }

  // 相関分析
  console.log('\n[4/4] シグナル - リターン相関を分析中...');
  const correlation = analyzeSignalCorrelation(retUs, retJp, retJpOc, CONFIG);

  console.log('\n' + '='.repeat(70));
  console.log('【結果 2】シグナル - リターン相関');
  console.log('='.repeat(70));
  console.log(`平均相関：${(correlation.avgCorrelation * 100).toFixed(3)}%`);
    
  if (correlation.avgCorrelation > 0.1) {
    console.log('✓ 良好：正の相関');
  } else if (correlation.avgCorrelation > 0) {
    console.log('△ 微弱：弱い正の相関');
  } else {
    console.log('✗ 不良：負の相関または無相関');
  }

  console.log('\n【銘柄別相関】');
  console.log('Ticker'.padEnd(10) + 'Label'.padEnd(15) + 'Correlation'.padStart(12));
  console.log('-'.repeat(37));
  for (const c of correlation.sectorCorrelations) {
    console.log(
      c.sector.padEnd(10) +
            (c.label || 'N/A').padEnd(15) +
            `${(c.correlation * 100).toFixed(3)}%`.padStart(12)
    );
  }

  // 月別精度
  console.log('\n【月別精度（直近 12 ヶ月）】');
  console.log('Month'.padEnd(10) + 'Accuracy'.padStart(10) + 'Samples'.padStart(10));
  console.log('-'.repeat(30));
  const recent12 = accuracy.monthlyAccuracy.slice(-12);
  for (const m of recent12) {
    console.log(
      m.month.padEnd(10) +
            `${(m.accuracy * 100).toFixed(2)}%`.padStart(10) +
            String(m.samples).padStart(10)
    );
  }

  // 結果保存
  const report = {
    analysisDate: new Date().toISOString().split('T')[0],
    dataPeriod: { start: dates[0], end: dates[dates.length - 1], tradingDays: dates.length },
    parameters: CONFIG,
    directionAccuracy: {
      overall: accuracy.overallAccuracy,
      totalSamples: accuracy.totalSamples,
      bySector: accuracy.sectorAccuracy,
      byMonth: accuracy.monthlyAccuracy
    },
    correlation: {
      average: correlation.avgCorrelation,
      bySector: correlation.sectorCorrelations
    }
  };

  fs.writeFileSync(
    path.join(outputDir, 'signal_accuracy_report.json'),
    JSON.stringify(report, null, 2)
  );

  // CSV 出力
  const sectorCSV = 'Ticker,Label,DirectionAccuracy,Correlation\n' +
        accuracy.sectorAccuracy.map((s, i) => 
          `${s.sector},${s.label || ''},${(s.accuracy * 100).toFixed(4)},${(correlation.sectorCorrelations[i].correlation * 100).toFixed(4)}`
        ).join('\n');
  fs.writeFileSync(path.join(outputDir, 'signal_accuracy_by_sector.csv'), sectorCSV);

  const monthlyCSV = 'Month,Accuracy,Samples\n' +
        accuracy.monthlyAccuracy.map(m => `${m.month},${(m.accuracy * 100).toFixed(4)},${m.samples}`).join('\n');
  fs.writeFileSync(path.join(outputDir, 'signal_accuracy_monthly.csv'), monthlyCSV);

  console.log('\n' + '='.repeat(70));
  console.log('結果保存先:');
  console.log(`  - ${path.join(outputDir, 'signal_accuracy_report.json')}`);
  console.log(`  - ${path.join(outputDir, 'signal_accuracy_by_sector.csv')}`);
  console.log(`  - ${path.join(outputDir, 'signal_accuracy_monthly.csv')}`);
  console.log('='.repeat(70));

  // 考察
  console.log('\n【考察】');
  if (accuracy.overallAccuracy < 0.52) {
    console.log('・US→JP のリードラグ効果が 2018-2025 年データでは検出されていません');
    console.log('・以下の要因が考えられます：');
    console.log('  1) 市場環境の変化（米中貿易戦争、COVID-19、利上げサイクル）');
    console.log('  2) データ期間が短い（7 年間）');
    console.log('  3) 事前部分空間の構築方法に改善の余地');
    console.log('・代替戦略（PAIRS、損切りベース）の検討を推奨');
  } else {
    console.log('・一定のリードラグ効果が検出されています');
    console.log('・パラメータ最適化でさらに精度向上の可能性があります');
  }
}

if (require.main === module) {
  const { createLogger } = require('../lib/logger');
  const logger = createLogger('SignalAccuracyAnalysis');

  main().catch(error => {
    logger.error('Analysis failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { analyzeSignalAccuracy, analyzeSignalCorrelation };
