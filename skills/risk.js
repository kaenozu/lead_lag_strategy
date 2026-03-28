/**
 * Risk Management Skill
 * 
 * Calculates risk metrics and position sizing
 */

const { createSkill } = require('./skill-base');
const { fetchOhlcvForTickers, buildReturnMatricesFromOhlcv } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { config } = require('../lib/config');
const { correlationMatrixSample, covarianceMatrix } = require('../lib/math');

module.exports = createSkill({
  name: 'risk',
  description: 'リスク管理とポジションサイジング計算',
  
  defaultConfig: {
    // リスクパラメータ
    lookbackDays: 252,  // 1 年
    confidenceLevel: 0.95,
    targetVolatility: 0.10,  // 年率 10%
    // ポジション制限
    maxPositionSize: 0.20,  // 単一銘柄最大 20%
    maxGrossExposure: 2.0,   // 最大グロス 200%
    maxNetExposure: 0.5,     // 最大ネット 50%
    // 取引コスト
    transactionCost: 0.001
  },
  
  async run(skillConfig) {
    const results = {
      timestamp: new Date().toISOString(),
      volatility: {},
      correlation: {},
      var: {},
      positionLimits: {},
      recommendations: []
    };
    
    // 1. 市場データ取得
    console.log('📈 市場データ取得中...');
    const allTickers = [...US_ETF_TICKERS, ...JP_ETF_TICKERS];
    
    const fetchResult = await fetchOhlcvForTickers(
      allTickers,
      skillConfig.lookbackDays,
      config
    );
    
    // 2. リターン行列構築
    console.log('📊 リターン行列構築中...');
    const { returnsUs, returnsJp } = buildReturnMatricesFromOhlcv(
      fetchResult.byTicker,
      US_ETF_TICKERS,
      JP_ETF_TICKERS
    );
    
    const allReturns = [...returnsUs, ...returnsJp].filter(r => r.length > 0);
    
    // 3. ボラティリティ計算
    console.log('📉 ボラティリティ計算中...');
    const volatilities = {};
    
    // 日本銘柄のボラティリティ
    for (let i = 0; i < JP_ETF_TICKERS.length; i++) {
      const ticker = JP_ETF_TICKERS[i];
      const returns = returnsJp.map(r => r[i]).filter(r => r !== null && r !== undefined);
      
      if (returns.length > 0) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sq, r) => sq + Math.pow(r - mean, 2), 0) / returns.length;
        const dailyVol = Math.sqrt(variance);
        const annualVol = dailyVol * Math.sqrt(252);
        
        volatilities[ticker] = {
          daily: dailyVol,
          annual: annualVol,
          percentile: 0  // Will calculate below
        };
      }
    }
    
    // パーセンタイル計算
    const volValues = Object.values(volatilities).map(v => v.annual);
    volValues.sort((a, b) => a - b);
    
    for (const ticker of Object.keys(volatilities)) {
      const vol = volatilities[ticker].annual;
      const rank = volValues.findIndex(v => v >= vol) / volValues.length;
      volatilities[ticker].percentile = rank;
    }
    
    results.volatility = {
      byTicker: volatilities,
      mean: volValues.reduce((a, b) => a + b, 0) / volValues.length,
      median: volValues[Math.floor(volValues.length / 2)],
      max: Math.max(...volValues),
      min: Math.min(...volValues)
    };
    
    // 4. 相関行列計算
    console.log('🔢 相関行列計算中...');
    const corrMatrix = correlationMatrixSample(returnsJp);
    
    // 平均相関
    let sumCorr = 0;
    let count = 0;
    for (let i = 0; i < corrMatrix.length; i++) {
      for (let j = i + 1; j < corrMatrix[i].length; j++) {
        sumCorr += corrMatrix[i][j];
        count++;
      }
    }
    const avgCorrelation = sumCorr / count;
    
    results.correlation = {
      matrix: corrMatrix,
      average: avgCorrelation,
      max: Math.max(...corrMatrix.flat()),
      min: Math.min(...corrMatrix.flat())
    };
    
    // 5. VaR 計算（Value at Risk）
    console.log('📏 VaR 計算中...');
    const portfolioReturns = returnsJp.map(row => {
      return row.reduce((sum, r) => sum + (r || 0), 0) / row.length;
    });
    
    portfolioReturns.sort((a, b) => a - b);
    const varIndex = Math.floor((1 - skillConfig.confidenceLevel) * portfolioReturns.length);
    const var95 = Math.abs(portfolioReturns[varIndex]);
    const expectedShortfall = portfolioReturns.slice(0, varIndex + 1)
      .reduce((a, b) => a + b, 0) / (varIndex + 1);
    
    results.var = {
      confidenceLevel: skillConfig.confidenceLevel,
      var95: {
        daily: var95,
        annual: var95 * Math.sqrt(252)
      },
      expectedShortfall: {
        daily: Math.abs(expectedShortfall),
        annual: Math.abs(expectedShortfall) * Math.sqrt(252)
      }
    };
    
    // 6. ポジション制限計算
    console.log('💼 ポジション制限計算中...');
    const avgVol = results.volatility.mean;
    const targetVol = skillConfig.targetVolatility;
    
    // ボラティリティターゲットに基づくポジションサイズ
    const volScaling = targetVol / avgVol;
    
    results.positionLimits = {
      targetVolatility: targetVol,
      currentVolatility: avgVol,
      volatilityScaling: volScaling,
      maxPositionPerName: skillConfig.maxPositionSize,
      maxGrossExposure: skillConfig.maxGrossExposure,
      maxNetExposure: skillConfig.maxNetExposure,
      recommendedGross: Math.min(volScaling, skillConfig.maxGrossExposure),
      recommendedNet: Math.min(volScaling * 0.5, skillConfig.maxNetExposure)
    };
    
    // 7. レコメンデーション生成
    if (avgVol > targetVol * 1.5) {
      results.recommendations.push({
        type: 'WARNING',
        message: 'ボラティリティがターゲットを大幅に上回っています。ポジションサイズを縮小してください。',
        action: 'REDUCE_POSITION'
      });
    }
    
    if (avgCorrelation > 0.7) {
      results.recommendations.push({
        type: 'INFO',
        message: '相関が高く、分散効果が限定的です。',
        action: 'MONITOR_CONCENTRATION'
      });
    }
    
    if (volScaling < 0.5) {
      results.recommendations.push({
        type: 'OPPORTUNITY',
        message: 'ボラティリティが低いため、ポジションサイズを拡大できます。',
        action: 'INCREASE_POSITION'
      });
    }
    
    console.log('✅ リスク計算完了');
    console.log(`   平均ボラティリティ：${(avgVol * 100).toFixed(2)}%`);
    console.log(`   平均相関：${(avgCorrelation * 100).toFixed(2)}%`);
    console.log(`   VaR(95%): ${(var95 * 100).toFixed(2)}%`);
    
    return results;
  }
});
