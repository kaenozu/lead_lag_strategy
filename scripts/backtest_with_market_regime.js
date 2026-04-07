/**
 * 市場環境フィルタ付きバックテスト
 * 弱気相場での取引を抑制
 * 
 * Usage: node scripts/backtest_with_market_regime.js
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
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { createLogger } = require('../lib/logger');
const { computePerformanceMetrics } = require('../lib/portfolio');
const { determineMarketRegime, MarketRegime } = require('../lib/marketRegime');
const {
  annualizedVolFromPrices,
  volatilityExposureScale,
  equityDrawdownScale,
  DEFAULT_VOL_EXPOSURE,
  DEFAULT_EQUITY_DD_SCALING
} = require('../lib/riskExposure');

const logger = createLogger('BacktestWithMarketRegime');

// 取引コスト
const TRANSACTION_COST_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;

/**
 * 設定
 */
const BACKTEST_CONFIG = {
  // 最適パラメータ（ウォークフォワード結果）
  lambdaReg: 0.5,
  nFactors: 2,
  quantile: 0.2,
  shortRatio: 1.0,
  useEwma: false,
  ewmaHalflife: 30,
  
  // 市場環境フィルタ
  marketRegime: {
    enabled: true,
    lookback: 60,            // 60日MA（実データ198日以上で動作）
    bullThreshold: 1.02,     // MA比+2%超で強気判定
    bearThreshold: 0.98,     // MA比-2%未満で弱気判定
    positionSizeBull: 1.0,   // 強気時はフルポジション（P3直近OOSが好調なため維持）
    positionSizeBear: 0.0,   // 弱気時は取引停止（損失抑制）
    positionSizeNeutral: 0.75 // 中立時は75%（0.5→0.75: 短中期ドラッグを軽減）
  },
  
  // リスク管理
  dailyLossStop: 0.01,
  stopCooldownDays: 1,
  sectorFilterEnabled: true,
  sectorLookback: 60,
  sectorMinWinRate: 0.3,
  sectorMinReturn: -0.001,
  // bull 期間の quantile: 1.0 = 変更なし（P3直近好調のため過度な分散は行わない）
  bullQuantileMultiplier: 1.0,
  // シグナル品質フィルター（bull期間のダイナミックなポジション減少）
  useSignalQualityFilter: true,
  signalQualityWindow: 20,    // 直近N日のシグナル正解率を追跡
  signalQualityThreshold: 0.48, // これ以下ならbullでポジション縮小

  // 高ボラ時の曝露縮小（米国合成価格系列の実現ボラ、ルックアヘッドなし）
  volExposure: {
    ...DEFAULT_VOL_EXPOSURE,
    enabled: true,
    lookback: 20,
    refAnnualVol: 0.12,
    capAnnualVol: 0.30,
    minScale: 0.4,
    maxScale: 1.0
  },

  // エクイティDDに応じた縮小（累積損益ベース、当日リターン適用前のDD）
  equityDrawdownScaling: {
    ...DEFAULT_EQUITY_DD_SCALING,
    enabled: true,
    softDrawdown: 0.08,
    hardDrawdown: 0.18,
    scaleAtSoft: 1.0,
    scaleAtHard: 0.35
  }
};

/**
 * レジーム＋曝露縮小の A/B で同一開始日に揃えるウォームアップ
 * @param {number} windowLength
 * @param {typeof BACKTEST_CONFIG} params
 */
function computeUnifiedWarmup(windowLength, params) {
  const mrLb = params.marketRegime?.lookback ?? 60;
  const secLb = params.sectorLookback ?? 60;
  const volLb = params.volExposure?.lookback ?? DEFAULT_VOL_EXPOSURE.lookback;
  return Math.max(windowLength, mrLb, secLb, volLb + 2);
}

/**
 * 米国価格系列の構築（SPY 相当）
 */
function buildUSPriceSeries(returnsUs) {
  const prices = [];
  let cumulative = 100;
  
  returnsUs.forEach(ret => {
    const avgRet = ret.values.reduce((a, b) => a + b, 0) / ret.values.length;
    cumulative *= (1 + avgRet);
    prices.push(cumulative);
  });
  
  return prices;
}

/**
 * セクターパフォーマンス計算
 */
function calculateSectorPerformance(returnsJpOc, lookback, startDate) {
  const performance = {};
  
  JP_ETF_TICKERS.forEach((ticker, idx) => {
    // lookback 日分または利用可能な全データを使用
    const actualStart = Math.max(0, startDate - lookback);
    const tickerReturns = [];
    for (let i = actualStart; i < Math.min(startDate + 30, returnsJpOc.length); i++) {
      tickerReturns.push(returnsJpOc[i].values[idx]);
    }
    
    const wins = tickerReturns.filter(r => r > 0).length;
    const total = tickerReturns.length;
    const avgReturn = total > 0 ? tickerReturns.reduce((a, b) => a + b, 0) / total : 0;
    
    performance[ticker] = {
      ticker,
      winRate: total > 0 ? wins / total : 0,
      avgReturn,
      index: idx
    };
  });
  
  return performance;
}

/**
 * 除外銘柄リスト作成
 */
function getExcludedTickers(sectorPerformance, config) {
  if (!config.sectorFilterEnabled) return new Set();
  
  const excluded = new Set();
  Object.values(sectorPerformance).forEach(sp => {
    if (sp.winRate < config.sectorMinWinRate || sp.avgReturn < config.sectorMinReturn) {
      logger.info(`除外：${sp.ticker} - 勝率${(sp.winRate * 100).toFixed(1)}%, リターン${(sp.avgReturn * 100).toFixed(2)}%`);
      excluded.add(sp.index);
    }
  });
  
  return excluded;
}

/**
 * ポートフォリオ構築
 */
function buildPortfolio(signal, quantile, excludedIndices, positionSize = 1.0, shortRatio = 1.0) {
  const n = signal.length;
  const q = Math.max(1, Math.floor(n * quantile));
  
  const ranked = signal
    .map((val, idx) => ({ val, idx }))
    .filter(x => !excludedIndices.has(x.idx))
    .sort((a, b) => a.val - b.val);

  if (ranked.length === 0) return new Array(n).fill(0);

  const actualQ = Math.max(1, Math.min(q, Math.floor(ranked.length * quantile)));

  const longIndices = ranked.slice(-actualQ).map(x => x.idx);
  const shortIndices = ranked.slice(0, actualQ).map(x => x.idx);

  const weights = new Array(n).fill(0);
  const longWeight = (1.0 / actualQ) * positionSize;
  const shortWeight = -(1.0 / actualQ) * positionSize * shortRatio;

  for (const idx of longIndices) weights[idx] = longWeight;
  for (const idx of shortIndices) weights[idx] = shortWeight;

  return weights;
}

/**
 * バックテスト実行（市場環境フィルタ付き）
 */
function runBacktestWithMarketRegime(
  returnsUs,
  returnsJpOc,
  params,
  sectorLabels,
  CFull
) {
  const nJp = returnsJpOc[0].values.length;
  const strategyReturns = [];
  let prevWeights = null;
  const stopCooldownDays = Math.max(0, params.stopCooldownDays ?? BACKTEST_CONFIG.stopCooldownDays ?? 1);
  let stopCooldownRemaining = 0;

  // シグナル品質追跡（bull期間の動的ポジション調整用）
  const signalQualityWindow = params.signalQualityWindow ?? BACKTEST_CONFIG.signalQualityWindow;
  const signalQualityThreshold = params.signalQualityThreshold ?? BACKTEST_CONFIG.signalQualityThreshold;
  const minSignalHistoryForFilter = Math.max(1, Math.floor(signalQualityWindow / 2));
  const signalAccHistory = []; // 0 or 1: シグナルの方向正解履歴

  const signalGen = new LeadLagSignal({
    lambdaReg: params.lambdaReg,
    nFactors: params.nFactors,
    useEwma: params.useEwma || false,
    ewmaHalflife: params.ewmaHalflife || 30,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const windowLength = config.backtest.windowLength;
  const volLookback = params.volExposure?.lookback ?? DEFAULT_VOL_EXPOSURE.lookback;
  // 各判定に必要な最小履歴だけを warmup にする（過大な加算はしない）
  let warmupPeriod = Math.max(
    windowLength,
    params.marketRegime.lookback,
    params.sectorLookback,
    volLookback + 2
  );
  if (typeof params.fixedWarmupPeriod === 'number' && Number.isFinite(params.fixedWarmupPeriod)) {
    warmupPeriod = Math.max(warmupPeriod, params.fixedWarmupPeriod);
  }

  // 米国価格系列
  const usPrices = buildUSPriceSeries(returnsUs);

  let equity = 1;
  let equityPeak = 1;

  // セクターパフォーマンス計算
  const sectorPerformance = calculateSectorPerformance(
    returnsJpOc,
    params.sectorLookback,
    warmupPeriod
  );
  const excludedIndices = getExcludedTickers(sectorPerformance, params);

  logger.info(`除外銘柄数：${excludedIndices.size} / ${nJp}`);

  // 市場環境統計
  const regimeStats = {
    [MarketRegime.BULL]: { days: 0, return: 0 },
    [MarketRegime.BEAR]: { days: 0, return: 0 },
    [MarketRegime.NEUTRAL]: { days: 0, return: 0 }
  };

  const exposureStats = {
    tradingDays: 0,
    daysVolScaleLt1: 0,
    daysDdScaleLt1: 0,
    daysEitherScaleLt1: 0,
    sumVolScale: 0,
    sumDdScale: 0
  };

  // warmup 以降は、必要データがそろっているためシグナル計算を開始できる
  for (let i = warmupPeriod; i < returnsJpOc.length; i++) {
    const drawdown = equityPeak > 0 ? (equity - equityPeak) / equityPeak : 0;
    const ddScale = equityDrawdownScale(drawdown, params.equityDrawdownScaling);

    // 市場環境判定
    const priceSlice = usPrices.slice(0, i + 1);
    const marketRegime = determineMarketRegime(priceSlice, params.marketRegime);
    let positionSize = marketRegime.positionSize;

    const annVol = annualizedVolFromPrices(priceSlice, volLookback);
    const { scale: volScale } = volatilityExposureScale(annVol, params.volExposure);
    exposureStats.tradingDays++;
    exposureStats.sumVolScale += volScale;
    exposureStats.sumDdScale += ddScale;
    if (volScale < 1 - 1e-9) exposureStats.daysVolScaleLt1++;
    if (ddScale < 1 - 1e-9) exposureStats.daysDdScaleLt1++;
    if (volScale < 1 - 1e-9 || ddScale < 1 - 1e-9) exposureStats.daysEitherScaleLt1++;

    positionSize *= volScale * ddScale;

    // bull期間のシグナル品質フィルター（lookaheadなし：追跡履歴は前日までの実績）
    if (params.useSignalQualityFilter && marketRegime.regime === MarketRegime.BULL && signalAccHistory.length >= minSignalHistoryForFilter) {
      const currentQuality = signalAccHistory.reduce((a, b) => a + b, 0) / signalAccHistory.length;
      if (currentQuality < signalQualityThreshold) {
        positionSize = positionSize * Math.max(0, currentQuality / signalQualityThreshold);
      }
    }

    // ウィンドウデータ
    const windowStart = i - windowLength;
    const retUsWindow = returnsUs.slice(windowStart, i).map(r => r.values);
    const retJpWindow = returnsJpOc.slice(windowStart, i).map(r => r.values);
    const retUsLatest = returnsUs[i - 1].values;

    // シグナル計算
    const signal = signalGen.computeSignal(
      retUsWindow,
      retJpWindow,
      retUsLatest,
      sectorLabels,
      CFull
    );

    // ポートフォリオ構築（ポジションサイズ調整 + regime別 quantile）
    // bull期間はシグナルが希薄なため quantile を広げてリスク分散
    const bullQMultiplier = params.bullQuantileMultiplier ?? 1.0;
    const effectiveQuantile = (marketRegime.regime === MarketRegime.BULL && bullQMultiplier !== 1.0)
      ? Math.min(0.5, params.quantile * bullQMultiplier)
      : params.quantile;
    let weights = buildPortfolio(
      signal,
      effectiveQuantile,
      excludedIndices,
      positionSize,
      params.shortRatio ?? 1.0
    );

    // 損失ストップ発動中はポジションを一定日数フラット化
    const stopActive = stopCooldownRemaining > 0;
    if (stopActive) {
      weights = new Array(nJp).fill(0);
    }

    // シグナル平滑化
    const smoothingAlpha = 0.3;
    if (prevWeights && !stopActive && positionSize > 0) {
      for (let j = 0; j < weights.length; j++) {
        weights[j] = smoothingAlpha * weights[j] + (1 - smoothingAlpha) * prevWeights[j];
      }
    }

    // 損益計算
    const retOc = returnsJpOc[i].values;
    let portfolioReturn = 0;
    for (let j = 0; j < weights.length; j++) {
      if (weights[j] !== 0) {
        portfolioReturn += weights[j] * retOc[j];
      }
    }

    // 取引コスト（ポジションサイズ考慮）
    const turnover = weights.reduce((sum, w) => sum + Math.abs(w), 0) / 2;
    const cost = turnover * (TRANSACTION_COST_RATE + SLIPPAGE_RATE);
    let netReturn = portfolioReturn - cost;

    // 日次損失ストップ
    if (params.dailyLossStop > 0 && netReturn < -params.dailyLossStop) {
      netReturn = -params.dailyLossStop;
      stopCooldownRemaining = stopCooldownDays;
    }

    if (stopActive) {
      stopCooldownRemaining--;
    }

    equity *= (1 + netReturn);
    if (equity > equityPeak) equityPeak = equity;

    prevWeights = weights;

    strategyReturns.push({
      date: returnsJpOc[i].date,
      return: netReturn,
      regime: marketRegime.regime,
      positionSize,
      regimeMessage: marketRegime.message
    });

    // シグナル正解率記録（次ステップの品質判定に使用）
    if (weights.some(w => w > 0) && weights.some(w => w < 0)) {
      let longRet = 0, longCnt = 0, shortRet = 0, shortCnt = 0;
      for (let j = 0; j < weights.length; j++) {
        if (weights[j] > 0) { longRet += retOc[j]; longCnt++; }
        else if (weights[j] < 0) { shortRet += retOc[j]; shortCnt++; }
      }
      const correct = (longCnt > 0 && shortCnt > 0)
        ? ((longRet / longCnt) > (shortRet / shortCnt) ? 1 : 0)
        : 0;
      signalAccHistory.push(correct);
      if (signalAccHistory.length > signalQualityWindow) signalAccHistory.shift();
    }

    // 市場環境別統計
    regimeStats[marketRegime.regime].days++;
    regimeStats[marketRegime.regime].return += netReturn;
  }

  const returns = strategyReturns.map(r => r.return);
  const metrics = computePerformanceMetrics(returns);

  const td = exposureStats.tradingDays || 1;
  exposureStats.avgVolScale = exposureStats.sumVolScale / td;
  exposureStats.avgDdScale = exposureStats.sumDdScale / td;

  return {
    params,
    metrics,
    returns: strategyReturns,
    excludedIndices: Array.from(excludedIndices),
    regimeStats,
    exposureStats,
    warmupPeriod,
    totalReturn: metrics.Cumulative - 1,
    sharpeRatio: metrics.RR,
    maxDrawdown: metrics.MDD,
    winRate: strategyReturns.filter(r => r.return > 0).length / strategyReturns.length
  };
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(80));
  console.log('📈 市場環境フィルタ付きバックテスト');
  console.log('='.repeat(80));

  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  console.log(`\n📅 評価期間：${oneMonthAgo.toISOString().split('T')[0]} ~ ${today.toISOString().split('T')[0]}`);
  console.log('\n📋 市場環境フィルタ設定:');
  console.log(`  強気閾値：${(BACKTEST_CONFIG.marketRegime.bullThreshold * 100).toFixed(0)}%（MA 比）`);
  console.log(`  弱気閾値：${(BACKTEST_CONFIG.marketRegime.bearThreshold * 100).toFixed(0)}%（MA 比）`);
  console.log(`  強気時ポジション：${(BACKTEST_CONFIG.marketRegime.positionSizeBull * 100).toFixed(0)}%`);
  console.log(`  弱気時ポジション：${(BACKTEST_CONFIG.marketRegime.positionSizeBear * 100).toFixed(0)}%`);
  console.log(`  中立時ポジション：${(BACKTEST_CONFIG.marketRegime.positionSizeNeutral * 100).toFixed(0)}%`);
  console.log(`\n📉 曝露縮小:`);
  console.log(`  高ボラ縮小：${BACKTEST_CONFIG.volExposure.enabled ? 'ON' : 'OFF'}（${(BACKTEST_CONFIG.volExposure.refAnnualVol * 100).toFixed(0)}%〜${(BACKTEST_CONFIG.volExposure.capAnnualVol * 100).toFixed(0)}% 年率ボラで ${(BACKTEST_CONFIG.volExposure.minScale * 100).toFixed(0)}%〜100%）`);
  console.log(`  DD縮小：${BACKTEST_CONFIG.equityDrawdownScaling.enabled ? 'ON' : 'OFF'}（-${(BACKTEST_CONFIG.equityDrawdownScaling.softDrawdown * 100).toFixed(0)}% / -${(BACKTEST_CONFIG.equityDrawdownScaling.hardDrawdown * 100).toFixed(0)}% 帯でスケール）`);

  // データ取得
  const winDays = 500;
  console.log('\n📡 市場データ取得中...');

  const [usRes, jpRes] = await Promise.all([
    fetchOhlcvForTickers(US_ETF_TICKERS, winDays, config),
    fetchOhlcvForTickers(JP_ETF_TICKERS, winDays, config)
  ]);

  const usData = usRes.byTicker;
  const jpData = jpRes.byTicker;

  const { retUs, retJp, retJpOc } = buildReturnMatricesFromOhlcv(
    usData,
    jpData,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    config.backtest.jpWindowReturn
  );

  console.log(`📊 取得完了：${retUs.length}営業日分`);

  // 相関行列計算
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  // 市場環境フィルタなし（従来版）
  console.log('\n📊 従来版（市場環境フィルタなし）実行中...');
  const standardParams = {
    ...BACKTEST_CONFIG,
    marketRegime: {
      enabled: false,
      lookback: 200,
      positionSizeBull: 1.0,
      positionSizeBear: 1.0,
      positionSizeNeutral: 1.0
    },
    volExposure: { ...DEFAULT_VOL_EXPOSURE, enabled: false },
    equityDrawdownScaling: { ...DEFAULT_EQUITY_DD_SCALING, enabled: false }
  };

  const standardResult = runBacktestWithMarketRegime(
    retUs,
    retJpOc,
    standardParams,
    config.sectorLabels,
    CFull
  );

  const unifiedWarmup = computeUnifiedWarmup(config.backtest.windowLength, BACKTEST_CONFIG);
  console.log(`\n🔧 曝露 A/B 用統一ウォームアップ：${unifiedWarmup} 営業日（レジームのみ vs レジーム+曝露縮小）`);

  const regimeOnlyParams = {
    ...BACKTEST_CONFIG,
    volExposure: { ...BACKTEST_CONFIG.volExposure, enabled: false },
    equityDrawdownScaling: { ...BACKTEST_CONFIG.equityDrawdownScaling, enabled: false },
    fixedWarmupPeriod: unifiedWarmup
  };
  const fullRegimeParams = {
    ...BACKTEST_CONFIG,
    fixedWarmupPeriod: unifiedWarmup
  };

  console.log('\n📈 レジームのみ（高ボラ・DD縮小 OFF・同一ウォームアップ）実行中...');
  const regimeOnlyResult = runBacktestWithMarketRegime(
    retUs,
    retJpOc,
    regimeOnlyParams,
    config.sectorLabels,
    CFull
  );

  console.log('\n📈 レジーム + 曝露縮小（改善版・同一ウォームアップ）実行中...');
  const improvedResult = runBacktestWithMarketRegime(
    retUs,
    retJpOc,
    fullRegimeParams,
    config.sectorLabels,
    CFull
  );

  // 結果比較
  console.log('\n' + '='.repeat(80));
  console.log('📊 結果比較（全体）');
  console.log('='.repeat(80));

  console.log('\n指標            従来版        改善版        差分');
  console.log('-'.repeat(80));

  const compare = (label, std, imp) => {
    const diff = imp - std;
    const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
    console.log(`${label.padEnd(14)} ${std.toFixed(2).padStart(10)}  ${imp.toFixed(2).padStart(10)}  ${diffStr.padStart(10)}`);
  };

  compare('総利回り (%)', standardResult.totalReturn * 100, improvedResult.totalReturn * 100);
  compare('シャープレシオ', standardResult.sharpeRatio, improvedResult.sharpeRatio);
  compare('勝率 (%)', standardResult.winRate * 100, improvedResult.winRate * 100);
  compare('最大 DD (%)', standardResult.maxDrawdown * 100, improvedResult.maxDrawdown * 100);

  console.log('\n' + '-'.repeat(80));
  console.log('指標         レジームのみ   +曝露縮小      差分（曝露層のみ）');
  console.log('-'.repeat(80));

  const compareIso = (label, base, full) => {
    const diff = full - base;
    const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
    console.log(`${label.padEnd(12)} ${base.toFixed(2).padStart(12)}  ${full.toFixed(2).padStart(12)}  ${diffStr.padStart(14)}`);
  };

  compareIso('総利回り%', regimeOnlyResult.totalReturn * 100, improvedResult.totalReturn * 100);
  compareIso('シャープ', regimeOnlyResult.sharpeRatio, improvedResult.sharpeRatio);
  compareIso('勝率%', regimeOnlyResult.winRate * 100, improvedResult.winRate * 100);
  compareIso('最大DD%', regimeOnlyResult.maxDrawdown * 100, improvedResult.maxDrawdown * 100);

  const es = improvedResult.exposureStats;
  console.log('\n' + '='.repeat(80));
  console.log('📉 曝露縮小 発動サマリ（改善版・統一ウォームアップ期間）');
  console.log('='.repeat(80));
  console.log(`  取引日数：${es.tradingDays}`);
  console.log(`  高ボラ縮小発動日（volScale<1）：${es.daysVolScaleLt1}（${(es.daysVolScaleLt1 / (es.tradingDays || 1) * 100).toFixed(1)}%）`);
  console.log(`  DD縮小発動日（ddScale<1）：${es.daysDdScaleLt1}（${(es.daysDdScaleLt1 / (es.tradingDays || 1) * 100).toFixed(1)}%）`);
  console.log(`  いずれか発動日：${es.daysEitherScaleLt1}`);
  console.log(`  平均 volScale / ddScale：${es.avgVolScale.toFixed(3)} / ${es.avgDdScale.toFixed(3)}`);

  // 市場環境別統計
  console.log('\n' + '='.repeat(80));
  console.log('📊 市場環境別統計');
  console.log('='.repeat(80));

  Object.entries(improvedResult.regimeStats).forEach(([regime, stats]) => {
    const avgReturn = stats.days > 0 ? (stats.return / stats.days * 100) : 0;
    console.log(`${regime}: ${stats.days}日、平均リターン：${avgReturn.toFixed(3)}%/日、累積：${(stats.return * 100).toFixed(2)}%`);
  });

  // 除外銘柄
  console.log('\n' + '='.repeat(80));
  console.log('📋 除外銘柄（セクターフィルタ）');
  console.log('='.repeat(80));

  if (improvedResult.excludedIndices.length > 0) {
    improvedResult.excludedIndices.forEach(idx => {
      const ticker = JP_ETF_TICKERS[idx];
      console.log(`  ${ticker}`);
    });
  } else {
    console.log('  除外銘柄なし');
  }

  // JSON 出力
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    calculationDate: new Date().toISOString(),
    period: {
      start: oneMonthAgo.toISOString().split('T')[0],
      end: today.toISOString().split('T')[0]
    },
    unifiedWarmup,
    config: BACKTEST_CONFIG,
    standardResult: {
      totalReturn: standardResult.totalReturn,
      sharpeRatio: standardResult.sharpeRatio,
      winRate: standardResult.winRate,
      maxDrawdown: standardResult.maxDrawdown,
      warmupPeriod: standardResult.warmupPeriod
    },
    regimeOnlyResult: {
      totalReturn: regimeOnlyResult.totalReturn,
      sharpeRatio: regimeOnlyResult.sharpeRatio,
      winRate: regimeOnlyResult.winRate,
      maxDrawdown: regimeOnlyResult.maxDrawdown,
      warmupPeriod: regimeOnlyResult.warmupPeriod
    },
    improvedResult: {
      totalReturn: improvedResult.totalReturn,
      sharpeRatio: improvedResult.sharpeRatio,
      winRate: improvedResult.winRate,
      maxDrawdown: improvedResult.maxDrawdown,
      regimeStats: improvedResult.regimeStats,
      exposureStats: improvedResult.exposureStats,
      warmupPeriod: improvedResult.warmupPeriod
    },
    comparison: {
      totalReturnDiff: improvedResult.totalReturn - standardResult.totalReturn,
      sharpeRatioDiff: improvedResult.sharpeRatio - standardResult.sharpeRatio,
      winRateDiff: improvedResult.winRate - standardResult.winRate,
      maxDrawdownDiff: improvedResult.maxDrawdown - standardResult.maxDrawdown
    },
    exposureLayerOnly: {
      totalReturnDiff: improvedResult.totalReturn - regimeOnlyResult.totalReturn,
      sharpeRatioDiff: improvedResult.sharpeRatio - regimeOnlyResult.sharpeRatio,
      winRateDiff: improvedResult.winRate - regimeOnlyResult.winRate,
      maxDrawdownDiff: improvedResult.maxDrawdown - regimeOnlyResult.maxDrawdown
    }
  };

  const outputPath = path.join(outputDir, `backtest_market_regime_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 結果を保存しました：${outputPath}`);

  // 結論
  console.log('\n' + '='.repeat(80));
  console.log('💡 結論');
  console.log('='.repeat(80));

  if (improvedResult.sharpeRatio > standardResult.sharpeRatio) {
    console.log('✅ 市場環境フィルタによりパフォーマンスが改善しました！');
    console.log(`   シャープレシオ：${standardResult.sharpeRatio.toFixed(2)} → ${improvedResult.sharpeRatio.toFixed(2)}`);
  } else {
    console.log('⚠️ 市場環境フィルタの効果は限定的でした');
    console.log('   閾値調整を検討してください');
  }
  console.log(
    `   （同一ウォームアップ）曝露縮小レイヤのみ：シャープ ${regimeOnlyResult.sharpeRatio.toFixed(2)} → ${improvedResult.sharpeRatio.toFixed(2)}`
  );

  console.log('='.repeat(80));

  logger.info('Backtest with market regime completed', {
    standard: { totalReturn: standardResult.totalReturn, sharpeRatio: standardResult.sharpeRatio },
    regimeOnly: { totalReturn: regimeOnlyResult.totalReturn, sharpeRatio: regimeOnlyResult.sharpeRatio },
    improved: { totalReturn: improvedResult.totalReturn, sharpeRatio: improvedResult.sharpeRatio },
    exposureLayer: output.exposureLayerOnly
  });
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Backtest with market regime failed', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = {
  BACKTEST_CONFIG,
  buildUSPriceSeries,
  calculateSectorPerformance,
  buildPortfolio,
  computeUnifiedWarmup,
  runBacktestWithMarketRegime
};
