/**
 * 過去 1 ヶ月の実利益計算スクリプト
 * 実際のシグナルに従って売買していた場合の利益を計算
 * 
 * Usage: node scripts/calculate_real_profit.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const {
  fetchOhlcvForTickers,
  buildReturnMatricesFromOhlcv
} = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES } = require('../lib/constants');
const { createLogger } = require('../lib/logger');

const logger = createLogger('RealProfitCalculator');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005; // 0.05%
const SLIPPAGE_RATE = 0.001; // 0.1%

/**
 * 過去 1 ヶ月の営業日数を計算
 */
function getTradingDaysInLastMonth() {
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  
  // 約 20-22 営業日
  return Math.floor((today - oneMonthAgo) / (1000 * 60 * 60 * 24)) * 5 / 7;
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('📊 日米業種リードラグ戦略 - 過去 1 ヶ月実利益計算');
  console.log('='.repeat(80));
  
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  
  console.log(`\n📅 計算期間：${oneMonthAgo.toISOString().split('T')[0]} ~ ${today.toISOString().split('T')[0]}`);
  console.log('💰 初期資金：1,000,000 円');
  console.log(`📈 取引コスト：${(TRANSACTION_COST_RATE * 100).toFixed(2)}%`);
  console.log(`📉 スリッページ：${(SLIPPAGE_RATE * 100).toFixed(2)}%`);
  
  // データ取得（過去 3 ヶ月分を取得して直近 1 ヶ月を評価）
  const winDays = config.backtest.windowLength + 80;
  console.log(`\n📡 市場データ取得中...（過去${winDays}営業日分）`);
  
  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);
  
  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;
  
  for (const [t, err] of Object.entries({ ...usRes.errors, ...jpRes.errors })) {
    logger.error(`データ取得失敗：${t}`, { error: err });
  }
  
  const { retUs, retJp, retJpOc } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );
  
  console.log(`📊 取得完了：${retUs.length}営業日分`);
  
  if (retUs.length < config.backtest.windowLength + 20) {
    console.error(`❌ データ不足：${retUs.length} < ${config.backtest.windowLength + 20}`);
    process.exit(1);
  }
  
  // 相関行列計算
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  
  // シグナル生成器
  const signalGen = new LeadLagSignal({
    lambdaReg: config.backtest.lambdaReg,
    nFactors: config.backtest.nFactors,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });
  
  // 過去 1 ヶ月の営業日を特定
  const endDate = retUs.length - 1;
  const startDate = Math.max(0, endDate - Math.round(getTradingDaysInLastMonth())); // 約 1 ヶ月前
  
  console.log(`\n📈 評価期間：${retUs[startDate].date} ~ ${retUs[endDate].date}`);
  
  // シミュレーション
  let capital = 1000000; // 初期資金 100 万円
  let totalProfit = 0;
  let totalTrades = 0;
  let winningDays = 0;
  let losingDays = 0;
  let maxDrawdown = 0;
  let peakCapital = capital;
  
  const dailyResults = [];
  const positionHistory = [];
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 日次損益計算中...');
  console.log('='.repeat(80));
  
  // 各営業日についてシグナル生成→損益計算
  for (let i = startDate; i <= endDate; i++) {
    // ウィンドウデータ
    const windowStart = Math.max(0, i - config.backtest.windowLength);
    const retUsWindow = retUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = retJp.slice(windowStart, i).map(r => r.values);
    const retUsLatest = retUs[i - 1].values; // t-1 日の米国リターン
    
    // シグナル計算
    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      config.sectorLabels,
      CFull
    );
    
    // ランキング作成
    const signals = JP_ETF_TICKERS.map((ticker, idx) => ({
      ticker,
      name: JP_ETF_NAMES[ticker] || ticker,
      signal: signal[idx],
      latestReturn: retJp[i].values[idx]
    })).sort((a, b) => b.signal - a.signal);
    
    // 買い銘柄選択（上位 quantile）
    const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * config.backtest.quantile));
    const buyCandidates = signals.slice(0, buyCount);
    const shortCandidates = signals.slice(-buyCount);
    
    // ポートフォリオ構築（ロングショート）
    const weights = new Array(JP_ETF_TICKERS.length).fill(0);
    const weightPerStock = 1.0 / buyCount;
    
    buyCandidates.forEach(c => {
      const idx = JP_ETF_TICKERS.indexOf(c.ticker);
      weights[idx] = weightPerStock;
    });
    
    shortCandidates.forEach(c => {
      const idx = JP_ETF_TICKERS.indexOf(c.ticker);
      weights[idx] = -weightPerStock;
    });
    
    // 損益計算（OC リターン使用）
    const retOc = retJpOc[i].values;
    
    // ポートフォオリターン
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      if (weights[j] !== 0) {
        portfolioReturn += weights[j] * retOc[j];
      }
    }
    
    // 取引コスト
    const turnover = weights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
    const cost = turnover * (TRANSACTION_COST_RATE + SLIPPAGE_RATE);
    const netReturn = portfolioReturn - cost;
    
    // 資金更新
    const dailyProfit = capital * netReturn;
    capital += dailyProfit;
    totalProfit += dailyProfit;
    totalTrades++;
    
    if (dailyProfit > 0) {
      winningDays++;
    } else if (dailyProfit < 0) {
      losingDays++;
    }
    
    // 最大ドローダウン
    if (capital > peakCapital) {
      peakCapital = capital;
    }
    const drawdown = (capital - peakCapital) / peakCapital;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
    
    dailyResults.push({
      date: retJpOc[i].date,
      return: netReturn,
      profit: dailyProfit,
      capital,
      turnover,
      longCount: buyCandidates.length,
      shortCount: shortCandidates.length
    });
    
    // 上位 3 銘柄を記録
    positionHistory.push({
      date: retJpOc[i].date,
      longs: buyCandidates.slice(0, 3).map(c => c.ticker),
      shorts: shortCandidates.slice(0, 3).map(c => c.ticker),
      dailyReturn: netReturn * 100
    });
  }
  
  // 結果表示
  console.log('\n' + '='.repeat(80));
  console.log('📊 過去 1 ヶ月 売買ポジション履歴（上位 3 銘柄）');
  console.log('='.repeat(80));
  console.log('日付         予想リターン (%)  ロング (上位 3)              ショート (下位 3)');
  console.log('-'.repeat(80));
  
  positionHistory.forEach(ph => {
    const longStr = ph.longs.join(', ').replace(/\.T/g, '');
    const shortStr = ph.shorts.join(', ').replace(/\.T/g, '');
    console.log(
      `${ph.date}  ${ph.dailyReturn > 0 ? '+' : ''}${ph.dailyReturn.toFixed(2)}  ` +
      `L: ${longStr.padEnd(25)} S: ${shortStr}`
    );
  });
  
  // 日次損益詳細
  console.log('\n' + '='.repeat(80));
  console.log('📊 日次損益詳細');
  console.log('='.repeat(80));
  console.log('日付         損益 (円)     累積損益 (円)   資金 (円)      ターンオーバー');
  console.log('-'.repeat(80));
  
  dailyResults.forEach(dr => {
    const profitStr = dr.profit > 0 ? `+${dr.profit.toFixed(0)}` : dr.profit.toFixed(0);
    const cumulativeProfit = dailyResults.slice(0, dailyResults.indexOf(dr) + 1)
      .reduce((sum, r) => sum + r.profit, 0);
    console.log(
      `${dr.date}  ${profitStr.padStart(9)}  ${cumulativeProfit.toFixed(0).padStart(11)}  ` +
      `${dr.capital.toFixed(0).padStart(10)}  ${(dr.turnover * 100).toFixed(1)}%`
    );
  });
  
  // 総合結果
  const totalReturn = ((capital - 1000000) / 1000000) * 100;
  const avgDailyReturn = totalReturn / dailyResults.length;
  const dailyVolatility = Math.sqrt(
    dailyResults.reduce((sum, dr) => sum + Math.pow(dr.return - avgDailyReturn / 100, 2), 0) / dailyResults.length
  ) * Math.sqrt(252) * 100;
  const sharpeRatio = (avgDailyReturn * 252) / (dailyVolatility / Math.sqrt(252));
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 総合結果（過去 1 ヶ月）');
  console.log('='.repeat(80));
  console.log('初期資金：        1,000,000 円');
  console.log(`最終資金：        ${capital.toLocaleString(undefined, { maximumFractionDigits: 0 })} 円`);
  console.log('-'.repeat(80));
  console.log(`総損益：          ${totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} 円`);
  console.log(`総利回り：        ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
  console.log(`平均日次利回り：  ${avgDailyReturn >= 0 ? '+' : ''}${avgDailyReturn.toFixed(2)}%`);
  console.log(`日次ボラティリティ： ${dailyVolatility.toFixed(2)}%`);
  console.log(`シャープレシオ：   ${sharpeRatio.toFixed(2)}`);
  console.log('-'.repeat(80));
  console.log(`総取引日数：      ${totalTrades}日`);
  console.log(`勝ち日数：        ${winningDays}日 (${(winningDays / totalTrades * 100).toFixed(1)}%)`);
  console.log(`負け日数：        ${losingDays}日 (${(losingDays / totalTrades * 100).toFixed(1)}%)`);
  console.log(`勝率：            ${(winningDays / totalTrades * 100).toFixed(1)}%`);
  console.log(`最大ドローダウン： ${(maxDrawdown * 100).toFixed(2)}%`);
  console.log(`ピーク資金：      ${peakCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })} 円`);
  
  // 月換算
  const monthlyReturn = totalReturn;
  const annualizedReturn = Math.pow(1 + totalReturn / 100, 12) * 100 - 100;
  
  console.log('\n' + '='.repeat(80));
  console.log('📈 換算値');
  console.log('='.repeat(80));
  console.log(`月利：            ${monthlyReturn >= 0 ? '+' : ''}${monthlyReturn.toFixed(2)}%`);
  console.log(`年利（複利）：     ${annualizedReturn >= 0 ? '+' : ''}${annualizedReturn.toFixed(2)}%`);
  
  // 感度分析
  console.log('\n' + '='.repeat(80));
  console.log('📊 感度分析（取引コストの影響）');
  console.log('='.repeat(80));
  
  const costScenarios = [
    { label: 'コストなし', cost: 0 },
    { label: '標準（0.15%）', cost: 0.0015 },
    { label: '高コスト（0.3%）', cost: 0.003 },
    { label: '超高コスト（0.5%）', cost: 0.005 }
  ];
  
  console.log('\nシナリオ              総損益 (円)      利回り (%)');
  console.log('-'.repeat(80));
  
  costScenarios.forEach(scenario => {
    const totalCost = dailyResults.reduce((sum, dr) => sum + dr.turnover * scenario.cost * 1000000, 0);
    const adjustedProfit = totalProfit + totalCost - dailyResults.reduce((sum, dr) => sum + dr.turnover * scenario.cost * 1000000, 0);
    const adjustedReturn = (adjustedProfit / 1000000) * 100;
    console.log(
      `${scenario.label.padEnd(18)} ${adjustedProfit.toFixed(0).padStart(10)}  ${adjustedReturn.toFixed(2).padStart(8)}`
    );
  });
  
  // 警告
  console.log('\n' + '='.repeat(80));
  console.log('⚠️ 注意事項');
  console.log('='.repeat(80));
  console.log('・この計算は過去のデータに基づくバックテスト結果です');
  console.log('・実際の取引では約定価格、執行遅延、流動性制約が追加で発生します');
  console.log('・日本 ETF は 100 株単位での取引ですが、本計算では分数を許可しています');
  console.log('・ショート売りは実際には追加コストと制約があります');
  console.log('・過去のパフォーマンスは将来の結果を保証するものではありません');
  console.log('・投資判断は自己責任でお願いします');
  console.log('='.repeat(80));
  
  // JSON 出力
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const output = {
    calculationDate: new Date().toISOString(),
    period: {
      start: retUs[startDate].date,
      end: retUs[endDate].date
    },
    summary: {
      initialCapital: 1000000,
      finalCapital: capital,
      totalProfit,
      totalReturn,
      avgDailyReturn,
      dailyVolatility,
      sharpeRatio,
      winRate: winningDays / totalTrades,
      maxDrawdown,
      totalTrades,
      winningDays,
      losingDays
    },
    dailyResults,
    positionHistory
  };
  
  const outputPath = path.join(outputDir, `real_profit_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`\n💾 結果を保存しました：${outputPath}`);
  
  logger.info('Real profit calculation completed', {
    totalProfit,
    totalReturn,
    sharpeRatio,
    winRate: winningDays / totalTrades
  });
}

main().catch(error => {
  logger.error('Real profit calculation failed', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
