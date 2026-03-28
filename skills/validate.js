/**
 * Data Validation Skill
 * 
 * Validates data integrity and quality
 */

const { createSkill } = require('./skill-base');
const { fetchOhlcvForTickers } = require('../lib/data');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('../lib/constants');
const { config } = require('../lib/config');

module.exports = createSkill({
  name: 'validate',
  description: 'データ完全性検証と品質チェック',
  
  defaultConfig: {
    lookbackDays: 252,
    checks: {
      missingData: true,
      priceValidity: true,
      returnAnomalies: true,
      correlationCheck: true,
      survivorshipBias: true
    },
    thresholds: {
      maxMissingDays: 10,
      maxReturnAnomaly: 0.20,  // 20% daily return
      minCorrelation: -0.95,
      maxCorrelation: 0.99
    }
  },
  
  async run(skillConfig) {
    const results = {
      timestamp: new Date().toISOString(),
      summary: {
        status: 'OK',
        totalChecks: 0,
        passed: 0,
        warnings: 0,
        errors: 0
      },
      usSectors: {},
      jpSectors: {},
      anomalies: [],
      recommendations: []
    };
    
    const allTickers = [...US_ETF_TICKERS, ...JP_ETF_TICKERS];
    const tickerGroups = {
      us: US_ETF_TICKERS,
      jp: JP_ETF_TICKERS
    };
    
    // 1. データ取得
    console.log('📥 データ取得中...');
    const fetchResult = await fetchOhlcvForTickers(
      allTickers,
      skillConfig.lookbackDays,
      config
    );
    
    // 2. 各セクターの検証
    for (const [group, tickers] of Object.entries(tickerGroups)) {
      const groupResults = {
        total: tickers.length,
        valid: 0,
        warnings: [],
        errors: []
      };
      
      for (const ticker of tickers) {
        const data = fetchResult.byTicker[ticker];
        const tickerChecks = validateTickerData(ticker, data, skillConfig);
        
        groupResults.valid += tickerChecks.valid ? 1 : 0;
        groupResults.warnings.push(...tickerChecks.warnings);
        groupResults.errors.push(...tickerChecks.errors);
        results.anomalies.push(...tickerChecks.anomalies);
        
        results.summary.totalChecks += 1;
        if (tickerChecks.valid) {
          results.summary.passed += 1;
        } else if (tickerChecks.errors.length > 0) {
          results.summary.errors += 1;
        } else {
          results.summary.warnings += 1;
        }
      }
      
      results[group + 'Sectors'] = groupResults;
    }
    
    // 3. 相関チェック
    if (skillConfig.checks.correlationCheck) {
      console.log('🔢 相関チェック中...');
      const correlationCheck = checkCorrelations(fetchResult, US_ETF_TICKERS, JP_ETF_TICKERS, skillConfig);
      results.correlation = correlationCheck;
      results.anomalies.push(...correlationCheck.anomalies);
    }
    
    // 4. サマリー更新
    if (results.summary.errors > 0) {
      results.summary.status = 'ERROR';
      results.recommendations.push({
        priority: 'HIGH',
        action: 'データソースの見直しが必要です',
        details: `${results.summary.errors} ticker(s) with critical errors`
      });
    } else if (results.summary.warnings > 0) {
      results.summary.status = 'WARNING';
      results.recommendations.push({
        priority: 'MEDIUM',
        action: '警告の確認をお勧めします',
        details: `${results.summary.warnings} ticker(s) with warnings`
      });
    }
    
    console.log('✅ 検証完了');
    console.log(`   状態：${results.summary.status}`);
    console.log(`   合格：${results.summary.passed}/${results.summary.totalChecks}`);
    console.log(`   警告：${results.summary.warnings}`);
    console.log(`   エラー：${results.summary.errors}`);
    
    return results;
  }
});

/**
 * Validate single ticker data
 */
function validateTickerData(ticker, data, config) {
  const result = {
    valid: true,
    warnings: [],
    errors: [],
    anomalies: []
  };
  
  // Check 1: Data existence
  if (!data || data.length === 0) {
    result.valid = false;
    result.errors.push({
      type: 'MISSING_DATA',
      ticker,
      message: 'データが存在しません'
    });
    result.anomalies.push({
      type: 'MISSING_DATA',
      severity: 'ERROR',
      ticker,
      description: 'No data available'
    });
    return result;
  }
  
  // Check 2: Sufficient history
  if (data.length < config.lookbackDays * 0.8) {
    result.valid = false;
    result.errors.push({
      type: 'INSUFFICIENT_DATA',
      ticker,
      message: `データ不足：${data.length} days < required ${Math.floor(config.lookbackDays * 0.8)}`
    });
    return result;
  }
  
  // Check 3: Price validity
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    if (row.close <= 0) {
      result.valid = false;
      result.errors.push({
        type: 'INVALID_PRICE',
        ticker,
        date: row.date,
        message: `価格が不正：close=${row.close}`
      });
    }
    
    if (row.high < row.low) {
      result.valid = false;
      result.errors.push({
        type: 'OHLC_INVALID',
        ticker,
        date: row.date,
        message: `High < Low: high=${row.high}, low=${row.low}`
      });
    }
  }
  
  // Check 4: Return anomalies
  for (let i = 1; i < data.length; i++) {
    const prevClose = data[i - 1].close;
    const currClose = data[i].close;
    const dailyReturn = (currClose - prevClose) / prevClose;
    
    if (Math.abs(dailyReturn) > config.thresholds.maxReturnAnomaly) {
      result.warnings.push({
        type: 'RETURN_ANOMALY',
        ticker,
        date: data[i].date,
        message: `異常リターン：${(dailyReturn * 100).toFixed(2)}%`
      });
      result.anomalies.push({
        type: 'RETURN_ANOMALY',
        severity: 'WARNING',
        ticker,
        date: data[i].date,
        return: dailyReturn,
        description: `Abnormal daily return: ${(dailyReturn * 100).toFixed(2)}%`
      });
    }
  }
  
  // Check 5: Missing dates (gaps)
  const dateGaps = [];
  for (let i = 1; i < data.length; i++) {
    const prevDate = new Date(data[i - 1].date);
    const currDate = new Date(data[i].date);
    const diffDays = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
    
    // Allow up to 3 days gap (weekends + holiday)
    if (diffDays > 3) {
      dateGaps.push({
        from: data[i - 1].date,
        to: data[i].date,
        gapDays: diffDays
      });
    }
  }
  
  if (dateGaps.length > config.thresholds.maxMissingDays) {
    result.warnings.push({
      type: 'EXCESSIVE_GAPS',
      ticker,
      message: `欠損日過多：${dateGaps.length} gaps detected`
    });
  }
  
  return result;
}

/**
 * Check correlation matrix for issues
 */
function checkCorrelations(fetchResult, usTickers, jpTickers, config) {
  const anomalies = [];
  
  // Simple correlation check placeholder
  // In real implementation, would calculate full correlation matrix
  
  return {
    checked: true,
    anomalies,
    note: 'Full correlation analysis requires returns calculation'
  };
}
