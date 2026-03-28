/**
 * 戦略改良版バックテスト
 * 為替フィルタ・ボラティリティ調整・市場環境フィルタを実装
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { LeadLagSignal } = require('../lib/pca');
const { correlationMatrixSample } = require('../lib/math');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');

// 基本パラメータ
const WINDOW_LENGTH = 60;
const N_FACTORS = 3;
const LAMBDA_REG = 0.80;
const QUANTILE = 0.45;

// 改良パラメータ
const FX_HEDGE = {
  enabled: true,
  lookback: 20,
  threshold: 0.02  // 2% 以上の円安でポジション削減
};

const VOLATILITY_ADJUSTMENT = {
  enabled: true,
  lookback: 20,
  targetVol: 0.10,  // 目標ボラティリティ 10%
  maxPosition: 1.0,
  minPosition: 0.0
};

const MARKET_FILTER = {
  enabled: true,
  lookback: 200,
  bullThreshold: 1.05,  // 価格/MA > 1.05 で強気
  bearThreshold: 0.95   // 価格/MA < 0.95 で弱気
};

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

console.log('='.repeat(80));
console.log('戦略改良版バックテスト - 為替・ボラティリティ・市場環境フィルタ');
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

// 為替レートの簡易計算（JP エ ETF の価格から逆算）
function calculateFXRate(jpData, dates) {
  const fxRates = {};
  
  // 1617.T（金）はドル建て資産として機能
  const proxyTicker = '1617.T';
  const proxyData = jpData[proxyTicker] || [];
  
  for (const date of dates) {
    const curr = proxyData.find(r => r.date === date);
    if (curr && curr.open > 0) {
      // 簡易的に ETF 価格を為替プロキシとして使用
      fxRates[date] = curr.open / 10000; // 正規化
    }
  }
  
  return fxRates;
}

// 為替フィルタ
function calculateFXFilter(fxRates, date, lookback, threshold) {
  const dates = Object.keys(fxRates).sort();
  const currentDate = dates.indexOf(date);
  
  if (currentDate < lookback) return 1.0;
  
  const currentRate = fxRates[date];
  const pastRate = fxRates[dates[currentDate - lookback]];
  
  if (!currentRate || !pastRate) return 1.0;
  
  const fxReturn = (currentRate - pastRate) / pastRate;
  
  // 円安（fxReturn > 0）の場合はポジション削減
  if (fxReturn > threshold) {
    return 0.5; // 50% 削減
  } else if (fxReturn < -threshold) {
    return 1.0; // 円高は通常運用
  }
  
  return 1.0;
}

// ボラティリティ調整
function calculateVolatilityAdjustment(dailyReturns, lookback, targetVol) {
  if (dailyReturns.length < lookback) return 1.0;
  
  const recentReturns = dailyReturns.slice(-lookback);
  const mean = recentReturns.reduce((a, b) => a + b, 0) / lookback;
  const variance = recentReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / lookback;
  const vol = Math.sqrt(variance) * Math.sqrt(252); // 年率ボラティリティ
  
  if (vol <= 0) return 1.0;
  
  const adjustment = targetVol / vol;
  return Math.min(Math.max(adjustment, 0.0), 1.0);
}

// 市場環境フィルタ
function calculateMarketFilter(prices, lookback, bullThreshold, bearThreshold) {
  if (prices.length < lookback) return 0.5;
  
  const slice = prices.slice(-lookback);
  const ma = slice.reduce((a, b) => a + b, 0) / lookback;
  const currentPrice = prices[prices.length - 1];
  
  if (ma <= 0) return 0.5;
  
  const ratio = currentPrice / ma;
  
  if (ratio >= bullThreshold) return 1.0;   // 強気：通常運用
  if (ratio <= bearThreshold) return 0.0;   // 弱気：取引停止
  return 0.5;                                // 中立：50% ポジション
}

function runImprovedBacktest(retUs, retJp, retJpOc, sectorLabels, CFull, dates) {
  const signalGen = new LeadLagSignal({
    lambdaReg: LAMBDA_REG,
    nFactors: N_FACTORS,
    orderedSectorKeys: config.pca.orderedSectorKeys
  });

  const strategyReturns = [];
  const dailyReturns = [];
  let prevWeights = null;
  
  // フィルタ計算用
  const fxRates = calculateFXRate(retJpOc, dates);
  const jpPrices = []; // 市場環境判定用

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

    // 改良フィルタの適用
    let positionSize = 1.0;

    // 1. 為替フィルタ
    if (FX_HEDGE.enabled) {
      const fxFilter = calculateFXFilter(fxRates, retJpOc[i].date, FX_HEDGE.lookback, FX_HEDGE.threshold);
      positionSize *= fxFilter;
    }

    // 2. ボラティリティ調整
    if (VOLATILITY_ADJUSTMENT.enabled && dailyReturns.length > 0) {
      const volFilter = calculateVolatilityAdjustment(
        dailyReturns,
        VOLATILITY_ADJUSTMENT.lookback,
        VOLATILITY_ADJUSTMENT.targetVol
      );
      positionSize *= volFilter;
    }

    // 3. 市場環境フィルタ
    if (MARKET_FILTER.enabled) {
      // 簡易的に TOPIX 相当の価格を計算（JP リターンの平均）
      const avgPrice = 10000 * (1 + dailyReturns.reduce((a, b) => a + b, 0));
      jpPrices.push(avgPrice);
      const marketFilter = calculateMarketFilter(
        jpPrices,
        MARKET_FILTER.lookback,
        MARKET_FILTER.bullThreshold,
        MARKET_FILTER.bearThreshold
      );
      positionSize *= marketFilter;
    }

    // ポジションサイズ適用
    portfolioReturn *= positionSize;

    prevWeights = [...weights];
    dailyReturns.push(portfolioReturn);

    strategyReturns.push({
      date: retJpOc[i].date,
      return: portfolioReturn,
      positionSize
    });
  }

  return { strategyReturns, dailyReturns };
}

function main() {
  console.log('\nデータ読み込み中...');
  const dataDir = path.join(__dirname, '..', 'backtest', 'data');
  
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  console.log('\nリターン行列構築中...');
  const { retUs, retJp, retJpOc, dates } = buildReturnMatrices(usData, jpData);
  console.log(`  取引日数：${dates.length}日 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  console.log('\n相関行列計算中...');
  const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);
  console.log(`  相関行列：${CFull.length}x${CFull[0].length}`);

  console.log('\n改良版バックテスト実行中...');
  console.log(`  為替フィルタ：${FX_HEDGE.enabled ? 'ON' : 'OFF'} (threshold: ${FX_HEDGE.threshold * 100}%)`);
  console.log(`  ボラティリティ調整：${VOLATILITY_ADJUSTMENT.enabled ? 'ON' : 'OFF'} (target vol: ${VOLATILITY_ADJUSTMENT.targetVol * 100}%)`);
  console.log(`  市場環境フィルタ：${MARKET_FILTER.enabled ? 'ON' : 'OFF'} (bull: ${MARKET_FILTER.bullThreshold}, bear: ${MARKET_FILTER.bearThreshold})`);
  
  const { strategyReturns, dailyReturns } = runImprovedBacktest(
    retUs, retJp, retJpOc, config.sectorLabels, CFull, dates
  );
  console.log(`  完了：${strategyReturns.length}日分`);

  // 全体パフォーマンス
  console.log('\n' + '='.repeat(80));
  console.log('全体パフォーマンス（改良版）');
  console.log('='.repeat(80));
  
  const totalMetrics = computePerformanceMetrics(dailyReturns, 252);
  console.log(`  期間：${dates[WINDOW_LENGTH]} ~ ${dates[dates.length - 1]}`);
  console.log(`  取引日数：${dailyReturns.length}日`);
  console.log(`  年率リターン (AR): ${(totalMetrics.AR * 100).toFixed(2)}%`);
  console.log(`  年率リスク (RISK): ${(totalMetrics.RISK * 100).toFixed(2)}%`);
  console.log(`  リスク・リターン比 (R/R): ${(totalMetrics.RR || 0).toFixed(2)}`);
  console.log(`  シャープレシオ： ${(totalMetrics.RR || 0).toFixed(2)}`);
  console.log(`  最大ドローダウン (MDD): ${(totalMetrics.MDD * 100).toFixed(2)}%`);
  console.log(`  累積リターン： ${((totalMetrics.Cumulative - 1) * 100).toFixed(2)}%`);
  console.log(`  勝率： ${((dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100).toFixed(1)}%`);

  // 従来版との比較
  console.log('\n' + '='.repeat(80));
  console.log('従来版との比較');
  console.log('='.repeat(80));
  
  // 従来版の数値（之前的なバックテストから）
  const baseline = {
    AR: -0.87,
    RR: -0.12,
    MDD: -20.64,
    cumulative: -7.39
  };

  const improved = {
    AR: totalMetrics.AR * 100,
    RR: totalMetrics.RR || 0,
    MDD: totalMetrics.MDD * 100,
    cumulative: (totalMetrics.Cumulative - 1) * 100
  };

  console.log('指標           従来版      改良版      改善幅');
  console.log('-'.repeat(50));
  console.log(`年率リターン   ${String(baseline.AR.toFixed(2)).padStart(9)}%  ${String(improved.AR.toFixed(2)).padStart(9)}%  ${String((improved.AR - baseline.AR).toFixed(2)).padStart(9)}%`);
  console.log(`R/R 比         ${String(baseline.RR.toFixed(2)).padStart(9)}   ${String(improved.RR.toFixed(2)).padStart(9)}   ${String((improved.RR - baseline.RR).toFixed(2)).padStart(9)}`);
  console.log(`最大 DD        ${String(baseline.MDD.toFixed(2)).padStart(9)}%  ${String(improved.MDD.toFixed(2)).padStart(9)}%  ${String((improved.MDD - baseline.MDD).toFixed(2)).padStart(9)}%`);
  console.log(`累積リターン   ${String(baseline.cumulative.toFixed(2)).padStart(9)}%  ${String(improved.cumulative.toFixed(2)).padStart(9)}%  ${String((improved.cumulative - baseline.cumulative).toFixed(2)).padStart(9)}%`);

  // 結果保存
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const reportPath = path.join(outputDir, 'improved_strategy_report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    version: 'improved_v1',
    filters: {
      fxHedge: FX_HEDGE,
      volatilityAdjustment: VOLATILITY_ADJUSTMENT,
      marketFilter: MARKET_FILTER
    },
    performance: {
      overall: {
        AR: improved.AR,
        RISK: totalMetrics.RISK * 100,
        RR: improved.RR,
        MDD: improved.MDD,
        cumulative: improved.cumulative,
        winRate: (dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100
      },
      comparison: {
        baseline,
        improved,
        improvement: {
          AR: improved.AR - baseline.AR,
          RR: improved.RR - baseline.RR,
          MDD: improved.MDD - baseline.MDD,
          cumulative: improved.cumulative - baseline.cumulative
        }
      }
    },
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
  if (improved.RR < 0) issues.push('シャープレシオがマイナス');
  if (improved.MDD < -20) issues.push('最大ドローダウンが 20% 超');
  if (improved.AR < 0) issues.push('年率リターンがマイナス');

  if (issues.length === 0) {
    console.log('  ✅ 良好：全ての指標が基準をクリア');
  } else {
    console.log('  ⚠️  改善が必要:');
    issues.forEach(issue => console.log(`    - ${issue}`));
  }

  // 次のステップ
  console.log('\n  次のステップ:');
  if (improved.RR < 0) {
    console.log('    1. マルチファクターモデルの導入（バリュー・クオリティ）');
    console.log('    2. 機械学習による市場環境予測');
    console.log('    3. 動的パラメータ調整の実装');
  } else {
    console.log('    1. 実運用に向けたリスク管理パラメータの最終調整');
    console.log('    2. 取引コストの精密化');
    console.log('    3. 監視システムの構築');
  }
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
