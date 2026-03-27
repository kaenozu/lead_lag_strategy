/**
 * 本日のシグナルに基づく収益シミュレーション
 * 10 万円資金で実際の買い銘柄を購入した場合の収益を試算
 * 
 * Usage: node scripts/simulate_profit.js
 */

'use strict';

const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');
const { createLogger } = require('../lib/logger');

const logger = createLogger('ProfitSimulator');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005; // 0.05%
const SLIPPAGE_RATE = 0.001; // 0.1%

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(70));
  console.log('📊 日米業種リードラグ戦略 - 本日の収益シミュレーション');
  console.log('='.repeat(70));
  console.log('\n💰 初期資金：100,000 円');
  console.log(`📈 取引コスト：${(TRANSACTION_COST_RATE * 100).toFixed(2)}%`);
  console.log(`📉 スリッページ：${(SLIPPAGE_RATE * 100).toFixed(2)}%`);
  
  // データ取得
  const winDays = Math.max(280, config.backtest.windowLength + 160);
  console.log('\n📡 Loading market data...');
  
  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);
  
  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;
  
  for (const [t, err] of Object.entries({ ...usRes.errors, ...jpRes.errors })) {
    logger.error(`Data load failed: ${t}`, { error: err });
  }
  
  const { retUs, retJp } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );
  
  console.log(`\n📊 Data prepared: ${retUs.length} trading days`);
  
  if (retUs.length < config.backtest.windowLength) {
    console.error(`Error: Insufficient data (${retUs.length} < ${config.backtest.windowLength})`);
    process.exit(1);
  }
  
  // 相関行列計算
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  
  // シグナル生成
  const signalGen = new LeadLagSignal({
    lambdaReg: config.backtest.lambdaReg,
    nFactors: config.backtest.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });
  
  const retUsWin = retUs.slice(-config.backtest.windowLength).map(r => r.values);
  const retJpWin = retJp.slice(-config.backtest.windowLength).map(r => r.values);
  const retUsLatest = retUs[retUs.length - 1].values;
  
  const signal = signalGen.computeSignal(
    retUsWin,
    retJpWin,
    retUsLatest,
    config.sectorLabels,
    CFull
  );
  
  // ランキング作成
  const signals = JP_ETF_TICKERS.map((ticker, i) => ({
    ticker,
    name: JP_ETF_NAMES[ticker] || ticker,
    sector: config.sectorLabels[`JP_${ticker}`] || 'unknown',
    signal: signal[i],
    latestReturn: retJp[retJp.length - 1].values[i],
    prevClose: jpData[ticker][jpData[ticker].length - 1].close,
    currentPrice: jpData[ticker][jpData[ticker].length - 1].close // 実際には翌日始値を使うべき
  })).sort((a, b) => b.signal - a.signal);
  
  signals.forEach((s, i) => s.rank = i + 1);

  // 買い銘柄選択
  const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * config.backtest.quantile));
  const buyCandidates = signals.slice(0, buyCount);

  const latestDate = retUs.length ? retUs[retUs.length - 1].date : null;

  console.log('\n' + '='.repeat(70));
  console.log(`📅 データ基準日：${latestDate || '不明'}`);
  console.log('='.repeat(70));
  console.log('\n📌 売買タイミング：');
  console.log(`  購入：${latestDate || '本日'} の終値`);
  console.log('  売却：翌営業日以降（シグナル通りリターン実現）');
  console.log('='.repeat(70));
  console.log('📈 本日の買い銘柄（ロング候補）');
  console.log('='.repeat(70));
  console.log('Rank  Ticker    業種           シグナル値    最新リターン (%)');
  console.log('-'.repeat(70));
  
  buyCandidates.forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${s.ticker.padEnd(8)} ${s.name.padEnd(12)} ${(s.signal * 1000).toFixed(2)}  ${(s.latestReturn * 100).toFixed(2)}`
    );
  });
  
  // シミュレーション
  const initialCapital = 100000;
  
  console.log('\n' + '='.repeat(70));
  console.log('💰 10 万円資金でのシミュレーション');
  console.log('='.repeat(70));
  console.log(`\n初期資金：${initialCapital.toLocaleString()} 円`);
  console.log(`戦略：上位 ${buyCount} 銘柄に均等投資`);
  
  // 各銘柄の購入可能株数と期待収益
  let totalExpectedProfit = 0;
  let totalInvestment = 0;
  let investableCount = 0;
  let remainingCapital = initialCapital;
  
  console.log('\n' + '-'.repeat(70));
  console.log('銘柄別詳細（予想）');
  console.log('-'.repeat(70));
  console.log('Ticker    株価      購入株数    投資額      期待リターン  期待収益');
  console.log('-'.repeat(70));
  
  buyCandidates.forEach(s => {
    const price = s.currentPrice;
    // 残高から購入可能株数を計算
    const maxAffordableUnits = Math.floor(remainingCapital / price);
    const perStockUnits = Math.floor((initialCapital / buyCount) / price);
    const tradableUnits = Math.max(maxAffordableUnits, perStockUnits);
    
    if (tradableUnits > 0) {
      investableCount++;
    }
    
    const actualInvestment = tradableUnits * price;
    
    // シグナル値を期待リターンとして使用（簡易版）
    const expectedReturnRate = s.signal;
    const expectedProfit = actualInvestment * expectedReturnRate;
    
    totalExpectedProfit += expectedProfit;
    totalInvestment += actualInvestment;
    remainingCapital -= actualInvestment;
    
    if (tradableUnits > 0) {
      console.log(
        `${s.ticker.padEnd(8)} ${price.toFixed(0).padStart(7)}  ${String(tradableUnits).padStart(6)}株  ` +
        `${actualInvestment.toLocaleString().padStart(8)}円  ${(expectedReturnRate * 100).toFixed(2)}%  ` +
        `${expectedProfit.toFixed(0).padStart(6)}円`
      );
    } else {
      console.log(
        `${s.ticker.padEnd(8)} ${price.toFixed(0).padStart(7)}  ${String(tradableUnits).padStart(6)}株  ` +
        `${'---'.padStart(8)}  ${(expectedReturnRate * 100).toFixed(2)}%  ` +
        `${'---'.padStart(6)}`
      );
    }
  });
  
  // 投資できない場合の警告
  if (investableCount === 0) {
    console.log('\n⚠️  警告：全銘柄で購入可能株数が 0 です（株価が高すぎます）');
    console.log('より少ない銘柄に集中投資するか、資金を増やす必要があります');
  } else if (investableCount < buyCount) {
    console.log(`\n⚠️  注意：${buyCount}銘柄中、実際に購入可能なのは${investableCount}銘柄です`);
  }
  
  // 取引コスト
  const transactionCost = totalInvestment * TRANSACTION_COST_RATE;
  const slippage = totalInvestment * SLIPPAGE_RATE;
  const totalCosts = transactionCost + slippage;
  
  // ネット期待収益
  const netExpectedProfit = totalExpectedProfit - totalCosts;
  const netReturnRate = totalInvestment > 0 ? netExpectedProfit / totalInvestment : 0;
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 総合結果');
  console.log('='.repeat(70));
  console.log(`総投資額：        ${totalInvestment.toLocaleString()} 円`);
  console.log(`取引コスト：      -${transactionCost.toFixed(0)} 円`);
  console.log(`スリッページ：    -${slippage.toFixed(0)} 円`);
  console.log(`総コスト：        -${totalCosts.toFixed(0)} 円`);
  console.log('-'.repeat(70));
  console.log(`期待収益（Gross）： ${totalExpectedProfit.toFixed(0)} 円`);
  console.log(`期待収益（Net）：   ${netExpectedProfit.toFixed(0)} 円`);
  console.log(`期待リターン：    ${(netReturnRate * 100).toFixed(2)}%`);
  console.log(`最終資金：        ${(initialCapital + netExpectedProfit).toLocaleString()} 円`);
  
  // 感度分析
  console.log('\n' + '='.repeat(70));
  console.log('📈 感度分析（シグナル値の变动による影響）');
  console.log('='.repeat(70));
  
  const scenarios = [
    { label: 'ベア（-50%）', factor: 0.5 },
    { label: '保守（-25%）', factor: 0.75 },
    { label: 'ベース', factor: 1.0 },
    { label: '楽観（+25%）', factor: 1.25 },
    { label: 'ブル（+50%）', factor: 1.5 }
  ];
  
  console.log('\nシナリオ        期待収益    最終資金');
  console.log('-'.repeat(70));
  
  scenarios.forEach(scenario => {
    const adjustedProfit = totalExpectedProfit * scenario.factor - totalCosts;
    const finalCapital = initialCapital + adjustedProfit;
    console.log(
      `${scenario.label.padEnd(12)} ${adjustedProfit.toFixed(0).padStart(7)}円  ${finalCapital.toLocaleString().padStart(10)}円`
    );
  });
  
  // 注意事項
  console.log('\n' + '='.repeat(70));
  console.log('⚠️ 注意事項');
  console.log('='.repeat(70));
  console.log('・このシミュレーションはシグナル値を期待リターンとして仮定しています');
  console.log('・実際の収益は市場環境、タイミング、執行価格により変動します');
  console.log('・ETF は 100 株単位での取引が一般的ですが、簡易計算しています');
  console.log('・過去のパフォーマンスは将来の結果を保証するものではありません');
  console.log('・投資判断は自己責任でお願いします');
  console.log('='.repeat(70));
  
  logger.info('Profit simulation completed', {
    initialCapital,
    totalInvestment,
    netExpectedProfit,
    netReturnRate
  });
}

main().catch(error => {
  logger.error('Profit simulation failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('Error:', error.message);
  process.exit(1);
});
