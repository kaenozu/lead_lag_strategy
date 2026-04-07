/**
 * Performance Analysis Skill
 * 
 * Detailed performance metrics and attribution analysis
 */

const { createSkill } = require('./skill-base');
const { runBacktest } = require('../backtest/real');

module.exports = createSkill({
  name: 'performance',
  description: '詳細なパフォーマンス分析とアトリビューション',
  
  defaultConfig: {
    // 分析期間
    startDate: '2018-01-01',
    endDate: new Date().toISOString().split('T')[0],
    // パラメータ
    windowLength: 60,
    lambdaReg: 0.9,
    quantile: 0.4,
    nFactors: 3,
    // 取引コスト
    transactionCost: 0.001,
    // 分析オプション
    includeAttribution: true,
    includeRollingMetrics: true,
    rollingWindow: 63  // 3 ヶ月
  },
  
  async run(skillConfig) {
    const results = {
      timestamp: new Date().toISOString(),
      summary: {},
      annualReturns: [],
      rollingMetrics: {},
      drawdown: {},
      attribution: {},
      benchmarks: {}
    };
    
    // 1. バックテスト実行
    console.log('📊 バックテスト実行中...');
    const backtestResult = await runBacktest({
      ...skillConfig,
      verbose: false
    });
    
    // 2. サマリーメトリクス
    const { totalReturn, annualReturn, risk, sharpe, maxDrawdown } = backtestResult.metrics;
    const trades = backtestResult.trades || [];
    const tradeCount = trades.length;
    const winCount = trades.filter(t => t.pnl > 0).length;
    const ddAbs = Math.abs(maxDrawdown);
    const calmarRatio = ddAbs > 0 ? annualReturn / ddAbs : (annualReturn > 0 ? Number.POSITIVE_INFINITY : 0);

    results.summary = {
      period: `${skillConfig.startDate} - ${skillConfig.endDate}`,
      totalReturn: totalReturn,
      annualReturn: annualReturn,
      annualRisk: risk,
      sharpeRatio: sharpe,
      maxDrawdown: maxDrawdown,
      calmarRatio,
      winRate: tradeCount > 0 ? winCount / tradeCount : 0,
      totalTrades: tradeCount,
      avgTrade: tradeCount > 0 ? trades.reduce((a, t) => a + t.pnl, 0) / tradeCount : 0
    };
    
    // 3. 年別リターン
    console.log('📈 年別リターン計算中...');
    const equityCurve = backtestResult.equityCurve;
    const yearlyReturns = {};
    
    for (const point of equityCurve) {
      const year = point.date.substring(0, 4);
      if (!yearlyReturns[year]) {
        yearlyReturns[year] = { start: point.equity, end: point.equity };
      }
      yearlyReturns[year].end = point.equity;
    }
    
    results.annualReturns = Object.entries(yearlyReturns).map(([year, data]) => ({
      year,
      return: (data.end / data.start) - 1,
      startEquity: data.start,
      endEquity: data.end
    }));
    
    // 4. ローリングメトリクス
    if (skillConfig.includeRollingMetrics) {
      console.log('📉 ローリングメトリクス計算中...');
      const rollingSharpe = [];
      const rollingReturn = [];
      const rollingRisk = [];
      
      for (let i = skillConfig.rollingWindow; i < equityCurve.length; i++) {
        const window = equityCurve.slice(i - skillConfig.rollingWindow, i);
        const returns = window.slice(1).map((p, idx) => {
          const prev = window[idx].equity;
          const curr = p.equity;
          return (curr - prev) / prev;
        });
        
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sq, r) => sq + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        const sharpeVal = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

        rollingSharpe.push({
          date: window[window.length - 1].date,
          sharpe: sharpeVal
        });
        
        rollingReturn.push({
          date: window[window.length - 1].date,
          return: avgReturn * 252
        });
        
        rollingRisk.push({
          date: window[window.length - 1].date,
          risk: stdDev * Math.sqrt(252)
        });
      }
      
      results.rollingMetrics = {
        sharpe: rollingSharpe,
        return: rollingReturn,
        risk: rollingRisk,
        window: skillConfig.rollingWindow
      };
    }
    
    // 5. ドローダウン分析
    console.log('📉 ドローダウン分析中...');
    let peak = -Infinity;
    const drawdowns = [];
    
    for (const point of equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const dd = (point.equity - peak) / peak;
      drawdowns.push({
        date: point.date,
        drawdown: dd,
        equity: point.equity
      });
    }
    
    // ドローダウン期間特定
    const ddPeriods = [];
    let inDrawdown = false;
    let start = null;
    let min = 0;
    
    for (const dd of drawdowns) {
      if (dd.drawdown < -0.01 && !inDrawdown) {
        inDrawdown = true;
        start = dd.date;
        min = dd.drawdown;
      } else if (inDrawdown) {
        if (dd.drawdown < min) {
          min = dd.drawdown;
        }
        if (dd.drawdown >= 0) {
          ddPeriods.push({
            start,
            end: dd.date,
            maxDrawdown: min,
            duration: Math.floor((new Date(dd.date) - new Date(start)) / (1000 * 60 * 60 * 24))
          });
          inDrawdown = false;
        }
      }
    }
    
    const negDrawdowns = drawdowns.filter(d => d.drawdown < 0);
    results.drawdown = {
      current: drawdowns[drawdowns.length - 1].drawdown,
      max: Math.min(...drawdowns.map(d => d.drawdown)),
      avgDrawdown: negDrawdowns.length > 0
        ? negDrawdowns.reduce((a, d) => a + d.drawdown, 0) / negDrawdowns.length
        : 0,
      periods: ddPeriods.sort((a, b) => a.maxDrawdown - b.maxDrawdown).slice(0, 10)
    };
    
    // 6. アトリビューション分析
    if (skillConfig.includeAttribution) {
      console.log('🔍 アトリビューション分析中...');
      
      const longTrades = backtestResult.trades.filter(t => t.side === 'long');
      const shortTrades = backtestResult.trades.filter(t => t.side === 'short');
      
      const longN = longTrades.length;
      const shortN = shortTrades.length;
      results.attribution = {
        long: {
          totalPnl: longTrades.reduce((a, t) => a + t.pnl, 0),
          trades: longN,
          winRate: longN > 0 ? longTrades.filter(t => t.pnl > 0).length / longN : 0,
          avgPnl: longN > 0 ? longTrades.reduce((a, t) => a + t.pnl, 0) / longN : 0
        },
        short: {
          totalPnl: shortTrades.reduce((a, t) => a + t.pnl, 0),
          trades: shortN,
          winRate: shortN > 0 ? shortTrades.filter(t => t.pnl > 0).length / shortN : 0,
          avgPnl: shortN > 0 ? shortTrades.reduce((a, t) => a + t.pnl, 0) / shortN : 0
        },
        byMonth: calculateMonthlyAttribution(backtestResult.trades)
      };
    }
    
    // 7. ベンチマーク比較
    results.benchmarks = {
      description: 'TOPIX 相当',
      note: 'ベンチマークデータは要追加'
    };
    
    console.log('✅ パフォーマンス分析完了');
    console.log(`   年率リターン：${(annualReturn * 100).toFixed(2)}%`);
    console.log(`   シャープレシオ：${sharpe.toFixed(2)}`);
    console.log(`   最大ドローダウン：${(maxDrawdown * 100).toFixed(2)}%`);
    
    return results;
  }
});

/**
 * Calculate monthly attribution
 */
function calculateMonthlyAttribution(trades) {
  const monthly = {};
  
  for (const trade of trades) {
    const month = trade.date.substring(0, 7);
    if (!monthly[month]) {
      monthly[month] = { pnl: 0, trades: 0 };
    }
    monthly[month].pnl += trade.pnl;
    monthly[month].trades += 1;
  }
  
  return Object.entries(monthly).map(([month, data]) => ({
    month,
    pnl: data.pnl,
    trades: data.trades
  }));
}
