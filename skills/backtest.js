/**
 * Backtest Skill
 * 
 * Executes parameter-optimized backtest with walk-forward analysis
 */

const { createSkill } = require('./skill-base');
const { runBacktestWithOptimization } = require('../backtest/improved');
const { runWalkForwardAnalysis } = require('../backtest/walkforward_open_to_close');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { config } = require('../lib/config');

module.exports = createSkill({
  name: 'backtest',
  description: 'パラメータ最適化バックテストとウォークフォワード分析',
  
  defaultConfig: {
    // 最適化パラメータ範囲
    paramGrid: {
      windowLength: [40, 60, 80],
      lambdaReg: [0.7, 0.8, 0.9],
      quantile: [0.3, 0.4, 0.5],
      nFactors: [2, 3, 4]
    },
    // 期間設定
    startDate: '2018-01-01',
    endDate: new Date().toISOString().split('T')[0],
    // ウォークフォワード設定
    walkForward: {
      trainPeriod: 252,  // 1 年
      testPeriod: 63,    // 3 ヶ月
      stepPeriod: 63     // 3 ヶ月ずつシフト
    },
    // 取引コスト
    transactionCost: 0.001,  // 0.1%
    // 並列処理
    parallel: true,
    verbose: true
  },
  
  async run(skillConfig) {
    const results = {
      parameterOptimization: null,
      walkForwardAnalysis: null,
      summary: {}
    };
    
    // 1. パラメータ最適化
    console.log('🔍 パラメータ最適化を実行中...');
    try {
      const optResult = await runBacktestWithOptimization({
        ...skillConfig,
        skipWalkForward: true
      });
      
      results.parameterOptimization = {
        optimalParameters: optResult.optimalParameters,
        performanceMetrics: optResult.metrics,
        parameterSensitivity: optResult.sensitivity
      };
      
      console.log('✅ パラメータ最適化完了');
      console.log('   最適パラメータ:', optResult.optimalParameters);
    } catch (error) {
      console.warn('⚠️ パラメータ最適化をスキップ:', error.message);
    }
    
    // 2. ウォークフォワード分析
    console.log('📊 ウォークフォワード分析を実行中...');
    try {
      const wfResult = await runWalkForwardAnalysis({
        ...skillConfig,
        parameters: results.parameterOptimization?.optimalParameters
      });
      
      results.walkForwardAnalysis = {
        outOfSampleMetrics: wfResult.outOfSample,
        inSampleMetrics: wfResult.inSample,
        stability: wfResult.stability
      };
      
      console.log('✅ ウォークフォワード分析完了');
    } catch (error) {
      console.warn('⚠️ ウォークフォワード分析をスキップ:', error.message);
    }
    
    // 3. サマリー作成
    results.summary = {
      usSectors: US_ETF_TICKERS.length,
      jpSectors: JP_ETF_TICKERS.length,
      period: `${skillConfig.startDate} - ${skillConfig.endDate}`,
      transactionCost: skillConfig.transactionCost,
      hasOptimization: !!results.parameterOptimization,
      hasWalkForward: !!results.walkForwardAnalysis
    };
    
    return results;
  }
});
