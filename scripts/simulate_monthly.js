/**
 * 1ヶ月（約22営業日）収益シミュレーション
 * 日米業種リードラグ戦略の直近1ヶ月パフォーマンスを試算し、
 * 月次・日次の損益推移と戦略特性（短期/中期/長期）も分析します。
 *
 * Usage: node scripts/simulate_monthly.js
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
const { __internal } = require('../src/server/services/strategyService');

const { computeMonthlyPerformance } = __internal;

const logger = createLogger('MonthlySimulator');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005; // 0.05%
const SLIPPAGE_RATE = 0.001; // 0.1%
const MONTHLY_TRADING_DAYS = 22; // 1ヶ月≒22営業日

/**
 * 日次ロングバスケット収益を計算（直近N日分）
 */
function simulateLastNDays(retUs, retJp, retJpOc, jpData, signalConfig, n) {
  const signalGen = new LeadLagSignal({
    lambdaReg: signalConfig.lambdaReg,
    nFactors: signalConfig.nFactors,
    orderedSectorKeys: signalConfig.orderedSectorKeys
  });
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  const windowLength = signalConfig.windowLength;
  const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * signalConfig.quantile));

  // 直近N日のバックテスト範囲
  const startIdx = Math.max(windowLength, retJpOc.length - n);
  const daily = [];

  for (let i = startIdx; i < retJpOc.length; i++) {
    const start = i - windowLength;
    const retUsWin = retUs.slice(start, i).map((r) => r.values);
    const retJpWin = retJp.slice(start, i).map((r) => r.values);
    const retUsLatest = retUs[i - 1].values;
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, config.sectorLabels, CFull);

    const ranked = signal.map((v, idx) => ({ v, idx })).sort((a, b) => b.v - a.v);
    const selected = ranked.slice(0, buyCount).map((x) => x.idx);
    const date = retJpOc[i].date;

    let dayProfitYen = 0;
    let dayReturnSum = 0;
    const picks = [];

    for (const idx of selected) {
      const ticker = JP_ETF_TICKERS[idx];
      const rows = jpData[ticker] || [];
      const bar = rows.find((r) => r.date === date) || null;
      const priceProfit = bar && Number.isFinite(bar.open) && Number.isFinite(bar.close) && bar.open > 0
        ? (bar.close - bar.open)
        : 0;
      const ret = retJpOc[i].values[idx];
      dayProfitYen += priceProfit;
      dayReturnSum += ret;
      picks.push({ ticker, name: JP_ETF_NAMES[ticker] || ticker, profit: Math.round(priceProfit * 100) / 100 });
    }

    const costDeduction = Math.abs(dayProfitYen) * (TRANSACTION_COST_RATE + SLIPPAGE_RATE);
    const netProfitYen = Math.round((dayProfitYen - costDeduction) * 100) / 100;
    const avgReturn = buyCount > 0 ? dayReturnSum / buyCount : 0;

    daily.push({ date, dayProfitYen: netProfitYen, avgReturn, picks });
  }

  return { daily, buyCount, CFull };
}

/**
 * 戦略適性（短期/中期/長期）を分析して説明文を返す
 */
function analyzeStrategyHorizon(daily) {
  if (daily.length === 0) {
    return { horizon: 'unknown', reason: 'データ不足' };
  }

  // 1日のシグナル回転率（どれだけ毎日売買が必要か）
  const tradingDays = daily.length;
  const winDays = daily.filter((d) => d.dayProfitYen > 0).length;
  const hitRate = tradingDays > 0 ? winDays / tradingDays : 0;

  // 連続損失の最大日数
  let maxLossStreak = 0;
  let currentStreak = 0;
  for (const d of daily) {
    if (d.dayProfitYen < 0) {
      currentStreak++;
      if (currentStreak > maxLossStreak) maxLossStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  // 日本-米国の翌日効果（ラグ）は短期（1日）フェノメノン
  const horizon = 'short_to_medium'; // 翌日寄り引け戦略

  const reasons = [
    '日米ラグ戦略は米国前日終値→日本翌日始値のシグナルを利用します（1営業日ホールド）。',
    `直近${tradingDays}日のヒット率：${(hitRate * 100).toFixed(1)}%`,
    `最大連続損失日数：${maxLossStreak}日`,
    'このラグ効果は短期（数日以内）で消滅するため、長期保有には不向きです。',
    '毎日シグナルを更新しながら売買する短期〜中期（スイング）戦略として設計されています。'
  ];

  return { horizon, hitRate: Math.round(hitRate * 10000) / 100, maxLossStreak, reasons };
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(70));
  console.log('📅 日米業種リードラグ戦略 - 1ヶ月収益シミュレーション');
  console.log('='.repeat(70));
  console.log(`\n📊 対象期間：直近約${MONTHLY_TRADING_DAYS}営業日（≒1ヶ月）`);
  console.log(`📈 取引コスト：${(TRANSACTION_COST_RATE * 100).toFixed(2)}%`);
  console.log(`📉 スリッページ：${(SLIPPAGE_RATE * 100).toFixed(2)}%`);

  // データ取得（ウォームアップ期間 + 1ヶ月分）
  const winDays = Math.max(280, config.backtest.windowLength + MONTHLY_TRADING_DAYS + 60);
  console.log('\n📡 市場データ取得中...');

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);

  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;

  for (const [t, err] of Object.entries({ ...usRes.errors, ...jpRes.errors })) {
    logger.error(`データ取得失敗: ${t}`, { error: err });
  }

  const { retUs, retJp, retJpOc } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  console.log(`\n📊 データ準備完了: ${retUs.length} 営業日`);

  if (retUs.length < config.backtest.windowLength + MONTHLY_TRADING_DAYS) {
    console.error(`エラー: データ不足 (${retUs.length} 日 < ${config.backtest.windowLength + MONTHLY_TRADING_DAYS} 日必要)`);
    process.exit(1);
  }

  const signalConfig = {
    windowLength: config.backtest.windowLength,
    lambdaReg: config.backtest.lambdaReg,
    nFactors: config.backtest.nFactors,
    quantile: config.backtest.quantile,
    orderedSectorKeys: config.pca.orderedSectorKeys
  };

  // 直近1ヶ月のシミュレーション
  console.log('\n⚙️  シミュレーション計算中...');
  const { daily, buyCount } = simulateLastNDays(
    retUs, retJp, retJpOc, jpData, signalConfig, MONTHLY_TRADING_DAYS
  );

  if (daily.length === 0) {
    console.error('エラー: シミュレーション結果が空です');
    process.exit(1);
  }

  const firstDate = daily[0].date;
  const lastDate = daily[daily.length - 1].date;

  // 月次サマリー
  const monthlyBreakdown = computeMonthlyPerformance(daily);

  // 累積損益
  let cumProfit = 0;
  const cumProfits = daily.map((d) => {
    cumProfit += d.dayProfitYen;
    return { date: d.date, cumProfit: Math.round(cumProfit * 100) / 100 };
  });

  const totalProfitYen = Math.round(daily.reduce((s, d) => s + d.dayProfitYen, 0) * 100) / 100;
  const winDaysCount = daily.filter((d) => d.dayProfitYen > 0).length;
  const lossDaysCount = daily.filter((d) => d.dayProfitYen < 0).length;
  const flatDaysCount = daily.length - winDaysCount - lossDaysCount;
  const hitRate = daily.length > 0 ? Math.round((winDaysCount / daily.length) * 10000) / 100 : 0;
  const avgDailyProfit = daily.length > 0 ? Math.round((totalProfitYen / daily.length) * 100) / 100 : 0;

  // 戦略期間分析
  const horizonAnalysis = analyzeStrategyHorizon(daily);

  // ---- 出力 ----
  console.log('\n' + '='.repeat(70));
  console.log(`📅 シミュレーション期間：${firstDate} 〜 ${lastDate}`);
  console.log(`📌 対象銘柄数（ロング）：上位 ${buyCount} 銘柄（1株ずつ）`);
  console.log('='.repeat(70));

  // 日次損益テーブル
  console.log('\n📋 日次損益（1株換算・コスト差引後）');
  console.log('-'.repeat(50));
  console.log('日付        損益(円)   累積損益(円)');
  console.log('-'.repeat(50));
  for (let i = 0; i < daily.length; i++) {
    const d = daily[i];
    const marker = d.dayProfitYen > 0 ? '▲' : d.dayProfitYen < 0 ? '▼' : '─';
    console.log(
      `${d.date}  ${marker} ${String(d.dayProfitYen.toFixed(2)).padStart(7)}  ${String(cumProfits[i].cumProfit.toFixed(2)).padStart(10)}`
    );
  }

  // 月次集計
  if (monthlyBreakdown.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('📆 月次集計');
    console.log('='.repeat(70));
    console.log('月         取引日  合計損益(円)  平均日次  ヒット率  勝/負/引');
    console.log('-'.repeat(70));
    for (const m of monthlyBreakdown) {
      console.log(
        `${m.month}  ${String(m.tradedDays).padStart(4)}日  ${String(m.totalProfitYen.toFixed(2)).padStart(10)}円  ` +
        `${String(m.averageDailyProfitYen.toFixed(2)).padStart(6)}円  ` +
        `${String(m.hitRatePct).padStart(5)}%  ${m.winDays}/${m.lossDays}/${m.flatDays}`
      );
    }
  }

  // 総合サマリー
  console.log('\n' + '='.repeat(70));
  console.log('📊 1ヶ月サマリー');
  console.log('='.repeat(70));
  console.log(`期間：          ${firstDate} 〜 ${lastDate}`);
  console.log(`取引日数：      ${daily.length} 日`);
  console.log(`合計損益：      ${totalProfitYen >= 0 ? '+' : ''}${totalProfitYen.toFixed(2)} 円`);
  console.log(`平均日次損益：  ${avgDailyProfit >= 0 ? '+' : ''}${avgDailyProfit.toFixed(2)} 円`);
  console.log(`ヒット率：      ${hitRate}%`);
  console.log(`勝ち日：        ${winDaysCount} 日`);
  console.log(`負け日：        ${lossDaysCount} 日`);
  console.log(`引き分け日：    ${flatDaysCount} 日`);

  // 戦略期間分析
  console.log('\n' + '='.repeat(70));
  console.log('🔍 戦略適性分析（短期/中期/長期）');
  console.log('='.repeat(70));
  for (const reason of horizonAnalysis.reasons) {
    console.log(`  ・${reason}`);
  }
  console.log('\n  \uD83D\uDCCC 結論：この戦略は「短期〜中期（スイング）」向けです');
  console.log('     毎日シグナルを更新し、翌日始値エントリー→引けクローズを繰り返します。');
  console.log('     長期では他のアルファ（モメンタム、バリュー）との組み合わせを推奨します。');

  // 注意事項
  console.log('\n' + '='.repeat(70));
  console.log('⚠️  注意事項');
  console.log('='.repeat(70));
  console.log('  ・1株あたりの損益であり、実際の損益は保有株数により異なります');
  console.log('  ・取引コスト・スリッページを差し引いた概算値です');
  console.log('  ・過去のパフォーマンスは将来の結果を保証するものではありません');
  console.log('  ・投資判断は自己責任でお願いします');
  console.log('='.repeat(70));

  logger.info('Monthly simulation completed', {
    period: `${firstDate} to ${lastDate}`,
    tradedDays: daily.length,
    totalProfitYen,
    hitRate
  });
}

main().catch((error) => {
  logger.error('Monthly simulation failed', { error: error.message, stack: error.stack });
  console.error('Error:', error.message);
  process.exit(1);
});
