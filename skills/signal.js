/**
 * Signal Generation Skill
 * 
 * Generates trading signals using latest market data
 */

const { createSkill } = require('./skill-base');
const { LeadLagSignal } = require('../lib/pca');
const { fetchOhlcvForTickers, buildReturnMatricesFromOhlcv } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');
const { config } = require('../lib/config');
const { correlationMatrixSample } = require('../lib/math');

module.exports = createSkill({
  name: 'signal',
  description: '最新市場データからの取引シグナル生成',
  
  defaultConfig: {
    // 使用データ数
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    // データ取得設定
    lookbackDays: 120,
    // シグナル閾値
    quantile: 0.4,
    // 出力設定
    includeDetails: true
  },
  
  async run(skillConfig) {
    const results = {
      timestamp: new Date().toISOString(),
      signals: [],
      rankings: { long: [], short: [] },
      metrics: {},
      dataQuality: {}
    };
    
    // 1. 市場データ取得
    console.log('📈 市場データ取得中...');
    const allTickers = [...US_ETF_TICKERS, ...JP_ETF_TICKERS];
    
    const fetchResult = await fetchOhlcvForTickers(
      allTickers,
      skillConfig.lookbackDays,
      config
    );
    
    // データ品質チェック
    results.dataQuality = {
      usSectors: {
        total: US_ETF_TICKERS.length,
        withData: US_ETF_TICKERS.filter(t => fetchResult.byTicker[t]?.length > 0).length,
        missing: US_ETF_TICKERS.filter(t => !fetchResult.byTicker[t]?.length)
      },
      jpSectors: {
        total: JP_ETF_TICKERS.length,
        withData: JP_ETF_TICKERS.filter(t => fetchResult.byTicker[t]?.length > 0).length,
        missing: JP_ETF_TICKERS.filter(t => !fetchResult.byTicker[t]?.length)
      }
    };
    
    // 2. リターン行列構築
    console.log('📊 リターン行列構築中...');
    const { returnsUs, returnsJp } = buildReturnMatricesFromOhlcv(
      fetchResult.byTicker,
      US_ETF_TICKERS,
      JP_ETF_TICKERS
    );
    
    // 3. 最新リターン取得
    const returnsUsLatest = returnsUs[returnsUs.length - 1];
    
    // 4. 相関行列計算（長期）
    console.log('🔢 相関行列計算中...');
    const CFull = correlationMatrixSample(
      [...returnsUs, ...returnsJp].slice(-skillConfig.windowLength)
    );
    
    // 5. シグナル計算
    console.log('🎯 シグナル計算中...');
    const signalGenerator = new LeadLagSignal({
      windowLength: skillConfig.windowLength,
      nFactors: skillConfig.nFactors,
      lambdaReg: skillConfig.lambdaReg
    });
    
    const signalValues = signalGenerator.computeSignal(
      returnsUs,
      returnsJp,
      returnsUsLatest,
      SECTOR_LABELS,
      CFull
    );
    
    // 6. シグナル整形
    const signalObjects = JP_ETF_TICKERS.map((ticker, i) => ({
      ticker,
      name: JP_ETF_TICKERS[ticker] || ticker,
      signal: signalValues[i],
      rank: 0  // Will be filled after sorting
    }));
    
    // ランキング作成
    signalObjects.sort((a, b) => b.signal - a.signal);
    signalObjects.forEach((item, i) => {
      item.rank = i + 1;
    });
    
    results.signals = signalObjects;
    
    // ロング・ショート銘柄選定
    const n = signalObjects.length;
    const q = Math.max(1, Math.round(n * skillConfig.quantile));
    
    results.rankings = {
      long: signalObjects.slice(0, q).map(s => ({
        ticker: s.ticker,
        signal: s.signal,
        weight: 1 / q
      })),
      short: signalObjects.slice(-q).map(s => ({
        ticker: s.ticker,
        signal: s.signal,
        weight: -1 / q
      }))
    };
    
    // 7. メトリクス計算
    results.metrics = {
      signalMean: signalValues.reduce((a, b) => a + b, 0) / signalValues.length,
      signalStd: Math.sqrt(
        signalValues.reduce((sq, x) => sq + x * x, 0) / signalValues.length -
        Math.pow(signalValues.reduce((a, b) => a + b, 0) / signalValues.length, 2)
      ),
      signalMin: Math.min(...signalValues),
      signalMax: Math.max(...signalValues),
      longCount: results.rankings.long.length,
      shortCount: results.rankings.short.length,
      netExposure: results.rankings.long.length - results.rankings.short.length
    };
    
    console.log('✅ シグナル生成完了');
    console.log(`   ロング: ${results.rankings.long.length}銘柄`);
    console.log(`   ショート: ${results.rankings.short.length}銘柄`);
    
    return results;
  }
});
