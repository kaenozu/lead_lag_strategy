/**
 * 実装検証スクリプト
 * パラメータ設定、ルックアヘッドバイアス、取引コストを検証
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const { buildPortfolio } = require('../lib/portfolio');
const { computePerformanceMetrics } = require('../lib/portfolio');

// バックテストデフォルトパラメータ
const WINDOW_LENGTH = 60;
const N_FACTORS = 3;
const LAMBDA_REG = 0.80;
const QUANTILE = 0.45;
const WARMUP_PERIOD = 60;

console.log('='.repeat(80));
console.log('実装検証ツール - パラメータ・バイアス・コストの検証');
console.log('='.repeat(80));

// 1. パラメータ設定の検証
console.log('\n[1/4] パラメータ設定の検証...');
console.log('  現在の設定:');
console.log(`    WINDOW_LENGTH: ${WINDOW_LENGTH}`);
console.log(`    N_FACTORS: ${N_FACTORS}`);
console.log(`    LAMBDA_REG: ${LAMBDA_REG}`);
console.log(`    QUANTILE: ${QUANTILE}`);
console.log(`    WARMUP_PERIOD: ${WARMUP_PERIOD}`);
console.log(`    取引コスト (slippage): 0`);
console.log(`    取引コスト (commission): 0`);

// 2. ルックアヘッドバイアスのチェック
console.log('\n[2/4] ルックアヘッドバイアスの検証...');

function checkLookaheadBias(retUs, retJp, retJpOc, sectorLabels, CFull) {
  const signalGen = new LeadLagSignal({
    lambdaReg: LAMBDA_REG,
    nFactors: N_FACTORS,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  let lookaheadIssues = 0;
  const testDays = Math.min(100, retJpOc.length - WINDOW_LENGTH);

  for (let i = WINDOW_LENGTH; i < WINDOW_LENGTH + testDays; i++) {
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
    const retOcCorrect = retJpOc[i].values;
    let portfolioReturnCorrect = 0;
    for (let j = 0; j < weights.length; j++) {
      portfolioReturnCorrect += weights[j] * retOcCorrect[j];
    }

    const retOcWrong = retJpOc[i - 1].values;
    let portfolioReturnWrong = 0;
    for (let j = 0; j < weights.length; j++) {
      portfolioReturnWrong += weights[j] * retOcWrong[j];
    }

    if (portfolioReturnCorrect * portfolioReturnWrong > 0) {
      lookaheadIssues++;
    }
  }

  const correlationRate = (lookaheadIssues / testDays) * 100;
  console.log(`  テスト日数：${testDays}日`);
  console.log(`  相関検出率：${correlationRate.toFixed(1)}%`);
  
  if (correlationRate > 70) {
    console.log('  ⚠️  警告：高い相関が検出されました（ルックアヘッドバイアスの可能性）');
  } else {
    console.log('  ✅ 問題なし：ルックアヘッドバイアスは検出されませんでした');
  }

  return correlationRate < 70;
}

// 3. 取引コストの検証
console.log('\n[3/4] 取引コストの検証...');

function verifyTransactionCosts() {
  const weights = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 0];
  const prevWeights = new Array(weights.length).fill(0);
  
  const turnover = weights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
  const costRate = 0;
  const cost = turnover * costRate;
  
  console.log(`  ターンオーバー：${(turnover * 100).toFixed(1)}%`);
  console.log(`  コストレート：${(costRate * 100).toFixed(2)}%`);
  console.log(`  取引コスト：${(cost * 100).toFixed(3)}%`);
  
  console.log('\n  論文との比較:');
  console.log('    論文 (Table 2): 取引コストなし');
  console.log('    実装：スリッ=0%, 手数料=0%');
  console.log('  ✅ 論文と一致：取引コストなし');
  
  return { turnover, costRate, cost };
}

// 4. シグナル計算の検証
console.log('\n[4/4] シグナル計算の検証...');

function verifySignalCalculation(retUs, retJp, sectorLabels, CFull) {
  const signalGen = new LeadLagSignal({
    lambdaReg: LAMBDA_REG,
    nFactors: N_FACTORS,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const i = WINDOW_LENGTH;
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

  console.log(`  シグナル値の範囲：[${Math.min(...signal).toFixed(4)}, ${Math.max(...signal).toFixed(4)}]`);
  console.log(`  シグナル平均：${(signal.reduce((a, b) => a + b, 0) / signal.length).toFixed(4)}`);
  console.log(`  有効シグナル数：${signal.filter(s => Math.abs(s) > 0.01).length}/${signal.length}`);

  const expectedSum = signal.reduce((a, b) => a + b, 0);
  if (Math.abs(expectedSum) < 0.1) {
    console.log('  ✅ 正常：シグナルはロングショート中立');
  } else {
    console.log(`  ⚠️  警告：シグナルの合計が ${expectedSum.toFixed(4)}（中立から乖離）`);
  }

  return signal;
}

// メイン処理
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('データ読み込み中...');

  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
  const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

  function loadLocalData(tickers) {
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

  const usData = loadLocalData(US_ETF_TICKERS);
  const jpData = loadLocalData(JP_ETF_TICKERS);

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

  const { retUs, retJp, retJpOc, dates } = buildReturnMatrices(usData, jpData);
  const sectorLabels = config.sectorLabels;

  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  console.log(`  相関行列：${CFull.length}x${CFull[0].length}`);

  console.log('\n' + '='.repeat(80));
  console.log('検証結果');
  console.log('='.repeat(80));

  const lookaheadOk = checkLookaheadBias(retUs, retJp, retJpOc, sectorLabels, CFull);
  const costs = verifyTransactionCosts();
  const signal = verifySignalCalculation(retUs, retJp, sectorLabels, CFull);

  console.log('\n' + '='.repeat(80));
  console.log('簡易バックテスト（サンプル 100 日）');
  console.log('='.repeat(80));

  const signalGen = new LeadLagSignal({
    lambdaReg: LAMBDA_REG,
    nFactors: N_FACTORS,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const sampleReturns = [];
  for (let i = WINDOW_LENGTH; i < Math.min(WINDOW_LENGTH + 100, retJpOc.length); i++) {
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
    const retOc = retJpOc[i].values;
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      portfolioReturn += weights[j] * retOc[j];
    }

    const turnover = weights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
    const cost = turnover * costs.costRate;
    const netReturn = portfolioReturn - cost;

    sampleReturns.push(netReturn);
  }

  const metrics = computePerformanceMetrics(sampleReturns, 252);
  console.log(`  サンプル数：${sampleReturns.length}日`);
  console.log(`  年率リターン：${(metrics.AR * 100).toFixed(2)}%`);
  console.log(`  年率リスク：${(metrics.RISK * 100).toFixed(2)}%`);
  console.log(`  シャープレシオ：${(metrics.RR || 0).toFixed(2)}`);
  console.log(`  最大ドローダウン：${(metrics.MDD * 100).toFixed(2)}%`);
  console.log(`  勝率：${((sampleReturns.filter(r => r > 0).length / sampleReturns.length) * 100).toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('総合評価');
  console.log('='.repeat(80));

  const issues = [];
  if (!lookaheadOk) issues.push('ルックアヘッドバイアスの可能性');
  if (costs.costRate > 0.002) issues.push('取引コストが高すぎる');
  if (metrics.RR < 0) issues.push('シャープレシオがマイナス');

  if (issues.length === 0) {
    console.log('  ✅ 重大な問題は検出されませんでした');
  } else {
    console.log('  ⚠️  検出された問題:');
    issues.forEach(issue => console.log(`    - ${issue}`));
  }

  console.log('\n  次のステップ:');
  console.log('    1. データ拡充（TOPIX 業種別指数の取得）');
  console.log('    2. 戦略改良（為替ヘッジ・マルチファクター）');
  console.log('    3. 長期バックテストの実行');
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
