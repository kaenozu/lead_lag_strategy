/**
 * 資金別収益シミュレーション
 * 異なる資金額での収益を比較
 * 
 * Usage: node scripts/simulate_profit_multi.js
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

const logger = createLogger('MultiProfitSimulator');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;

/**
 * 単一資金額のシミュレーション
 */
function simulateCapital(capital, buyCandidates) {
  const buyCount = buyCandidates.length;
  const perStockCapital = capital / buyCount;
  
  let totalExpectedProfit = 0;
  let totalInvestment = 0;
  let investableCount = 0;
  
  buyCandidates.forEach(s => {
    const price = s.currentPrice;
    const tradableUnits = Math.floor(perStockCapital / price);
    
    if (tradableUnits > 0) {
      investableCount++;
    }
    
    const actualInvestment = tradableUnits * price;
    const expectedReturnRate = s.signal;
    const expectedProfit = actualInvestment * expectedReturnRate;
    
    totalExpectedProfit += expectedProfit;
    totalInvestment += actualInvestment;
  });
  
  const transactionCost = totalInvestment * TRANSACTION_COST_RATE;
  const slippage = totalInvestment * SLIPPAGE_RATE;
  const totalCosts = transactionCost + slippage;
  const netExpectedProfit = totalExpectedProfit - totalCosts;
  const netReturnRate = totalInvestment > 0 ? netExpectedProfit / totalInvestment : 0;
  const finalCapital = capital + netExpectedProfit;
  
  return {
    capital,
    buyCount,
    investableCount,
    perStockCapital,
    totalInvestment,
    totalCosts,
    netExpectedProfit,
    netReturnRate,
    finalCapital,
    utilizationRate: totalInvestment / capital
  };
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('📊 日米業種リードラグ戦略 - 資金別収益シミュレーション');
  console.log('='.repeat(80));
  
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
    currentPrice: jpData[ticker][jpData[ticker].length - 1].close
  })).sort((a, b) => b.signal - a.signal);
  
  signals.forEach((s, i) => s.rank = i + 1);
  
  // 買い銘柄選択
  const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * config.backtest.quantile));
  const buyCandidates = signals.slice(0, buyCount);
  
  console.log('\n' + '='.repeat(80));
  console.log('📈 本日の買い銘柄（ロング候補）');
  console.log('='.repeat(80));
  console.log('Rank  Ticker    業種           シグナル値    株価        最新リターン (%)');
  console.log('-'.repeat(80));
  
  buyCandidates.forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${s.ticker.padEnd(8)} ${s.name.padEnd(12)} ${(s.signal * 1000).toFixed(2)}  ${s.currentPrice.toFixed(0).padStart(7)}  ${(s.latestReturn * 100).toFixed(2)}`
    );
  });
  
  // 資金別シミュレーション
  const capitalScenarios = [
    { label: '10 万円', value: 100000 },
    { label: '30 万円', value: 300000 },
    { label: '50 万円', value: 500000 },
    { label: '100 万円', value: 1000000 },
    { label: '300 万円', value: 3000000 },
    { label: '500 万円', value: 5000000 },
    { label: '1,000 万円', value: 10000000 }
  ];
  
  console.log('\n' + '='.repeat(80));
  console.log('💰 資金別シミュレーション結果');
  console.log('='.repeat(80));
  
  const results = capitalScenarios.map(scenario => {
    return simulateCapital(scenario.value, buyCandidates);
  });
  
  console.log('\n資金        投資額        投資率    期待収益    最終資金      利回り');
  console.log('-'.repeat(80));
  
  results.forEach((r, i) => {
    const label = capitalScenarios[i].label;
    console.log(
      `${label.padEnd(10)} ${r.totalInvestment.toLocaleString().padStart(10)}円  ` +
      `${(r.utilizationRate * 100).toFixed(1).padStart(5)}%  ` +
      `${r.netExpectedProfit.toFixed(0).padStart(8)}円  ` +
      `${r.finalCapital.toLocaleString().padStart(10)}円  ` +
      `${(r.netReturnRate * 100).toFixed(2).padStart(5)}%`
    );
  });
  
  // 詳細分析（10 万円と 100 万円）
  console.log('\n' + '='.repeat(80));
  console.log('📊 詳細分析：10 万円 vs 100 万円');
  console.log('='.repeat(80));
  
  [results[0], results[3]].forEach((r, idx) => {
    const capitalLabel = idx === 0 ? '10 万円' : '100 万円';
    console.log(`\n【${capitalLabel}の場合】`);
    console.log(`  投資可能銘柄数：${r.investableCount}/${buyCount}銘柄`);
    console.log(`  1 銘柄あたり資金：${r.perStockCapital.toLocaleString()}円`);
    console.log(`  総投資額：${r.totalInvestment.toLocaleString()}円`);
    console.log(`  資金効率：${(r.utilizationRate * 100).toFixed(1)}%`);
    console.log(`  取引コスト：${(r.totalCosts).toFixed(0)}円`);
    console.log(`  期待収益：${r.netExpectedProfit.toFixed(0)}円`);
    console.log(`  期待リターン：${(r.netReturnRate * 100).toFixed(2)}%`);
    console.log(`  最終資金：${r.finalCapital.toLocaleString()}円`);
  });
  
  // 推奨資金
  console.log('\n' + '='.repeat(80));
  console.log('💡 推奨資金分析');
  console.log('='.repeat(80));
  
  const minFullInvest = results.find(r => r.utilizationRate >= 0.95);
  if (minFullInvest) {
    const idx = results.indexOf(minFullInvest);
    console.log(`\n✅ 95% 以上の資金効率を達成する最小資金：${capitalScenarios[idx].label}`);
    console.log(`   投資率：${(minFullInvest.utilizationRate * 100).toFixed(1)}%`);
  }
  
  const bestRiskAdjusted = results.reduce((best, r, i) => {
    const score = r.netReturnRate * Math.sqrt(r.utilizationRate);
    return score > (best?.score || 0) ? { ...r, score, index: i } : best;
  }, null);
  
  if (bestRiskAdjusted) {
    console.log(`\n🏆 リスク調整後リターンが最大：${capitalScenarios[bestRiskAdjusted.index].label}`);
    console.log(`   スコア：${bestRiskAdjusted.score.toFixed(4)}`);
  }
  
  // 注意事項
  console.log('\n' + '='.repeat(80));
  console.log('⚠️ 注意事項');
  console.log('='.repeat(80));
  console.log('・このシミュレーションはシグナル値を期待リターンとして仮定しています');
  console.log('・実際の収益は市場環境、タイミング、執行価格により変動します');
  console.log('・ETF は 100 株単位での取引が一般的ですが、簡易計算しています');
  console.log('・過去のパフォーマンスは将来の結果を保証するものではありません');
  console.log('・投資判断は自己責任でお願いします');
  console.log('='.repeat(80));
  
  logger.info('Multi-capital simulation completed', {
    scenarios: results.length,
    bestReturn: Math.max(...results.map(r => r.netReturnRate))
  });
}

main().catch(error => {
  logger.error('Multi-capital simulation failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('Error:', error.message);
  process.exit(1);
});
