/**
 * ファクターモデルリスク分析
 * Factor Model Risk Analysis (Fama-French 3/4 Factor Model)
 * 
 * 注意：実際のファクターデータは Fama-French データベース等から取得する必要があります。
 * このスクリプトは分析フレームワークを提供します。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { LeadLagSignal } = require('../lib/pca');
const { buildLeadLagMatrices } = require('../lib/lead_lag_matrices');
const { buildPortfolio, computePerformanceMetrics } = require('../lib/portfolio');
const { correlationMatrixSample } = require('../lib/math');
const { US_ETF_TICKERS, JP_ETF_TICKERS, SECTOR_LABELS } = require('../lib/constants');

// ============================================================================
// 設定
// ============================================================================

const BASE_CONFIG = {
  windowLength: 60,
  nFactors: 3,
  lambdaReg: 0.9,
  quantile: 0.4,
  warmupPeriod: 60
};

// ファクターデータソース
const FACTOR_DATA_SOURCES = {
  // ケース 1: ローカル CSV ファイル
  local: {
    type: 'local',
    path: path.join(__dirname, '..', 'data', 'factor_data.csv')
  }
  // ケース 2: Fama-French データベース（手動ダウンロードが必要）
  // URL: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html
};

// ============================================================================
// データ読み込み
// ============================================================================

function loadLocalData(dataDir, tickers) {
  const results = {};
  for (const ticker of tickers) {
    const filePath = path.join(dataDir, `${ticker}.csv`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').slice(1).filter(l => l.trim());
      results[ticker] = lines.map(line => {
        const [date, open, high, low, close, volume] = line.split(',');
        return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume || 0 };
      });
    } else {
      results[ticker] = [];
    }
  }
  return results;
}

function loadFactorData(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  ファクターデータファイルが見つかりません：${filePath}`);
    console.log('  ダミーデータを生成します（分析フレームワークのデモ用）');
    return generateDummyFactorData();
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').slice(1).filter(l => l.trim());
    
  const factorData = {};
  for (const line of lines) {
    const [date, mkt_rf, smb, hml, rf] = line.split(',');
    factorData[date] = {
      MktRF: parseFloat(mkt_rf) / 100, // パーセント→小数
      SMB: parseFloat(smb) / 100,
      HML: parseFloat(hml) / 100,
      RF: parseFloat(rf) / 100
    };
  }

  return factorData;
}

function generateDummyFactorData() {
  // ダミーデータ生成（実際の分析では使用しないでください）
  const factorData = {};
  const startDate = new Date('2018-01-01');
  const endDate = new Date('2025-12-31');
    
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const date = currentDate.toISOString().split('T')[0];
        
    // ランダムなファクターリターン（デモ用）
    factorData[date] = {
      MktRF: (Math.random() - 0.5) * 0.04, // 月次 4% 程度
      SMB: (Math.random() - 0.5) * 0.02,
      HML: (Math.random() - 0.5) * 0.02,
      RF: 0.0001 // 日次リスクフリーレート
    };
        
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return factorData;
}

// ============================================================================
// ファクターモデル回帰
// ============================================================================

/**
 * 多変量線形回帰（OLS）
 * y = alpha + beta1*x1 + beta2*x2 + ... + epsilon
 */
function multipleRegression(y, X) {
  const n = y.length;
  const k = X[0].length;

  // X'X
  const XtX = [];
  for (let i = 0; i < k; i++) {
    XtX[i] = [];
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (let t = 0; t < n; t++) {
        sum += X[t][i] * X[t][j];
      }
      XtX[i][j] = sum;
    }
  }

  // X'y
  const Xty = [];
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let t = 0; t < n; t++) {
      sum += X[t][i] * y[t];
    }
    Xty[i] = sum;
  }

  // (X'X)^(-1) を計算（ガウス・ジョルダン法）
  const XtX_inv = invertMatrix(XtX);

  // beta = (X'X)^(-1) * X'y
  const beta = [];
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let j = 0; j < k; j++) {
      sum += XtX_inv[i][j] * Xty[j];
    }
    beta[i] = sum;
  }

  // 残差
  const residuals = [];
  for (let t = 0; t < n; t++) {
    let predicted = 0;
    for (let i = 0; i < k; i++) {
      predicted += beta[i] * X[t][i];
    }
    residuals[t] = y[t] - predicted;
  }

  // 標準誤差
  const s2 = residuals.reduce((a, b) => a + b * b, 0) / (n - k);
  const se = [];
  for (let i = 0; i < k; i++) {
    se[i] = Math.sqrt(s2 * XtX_inv[i][i]);
  }

  // t 統計量
  const tStats = [];
  for (let i = 0; i < k; i++) {
    tStats[i] = se[i] > 0 ? beta[i] / se[i] : 0;
  }

  // R 二乗
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((a, b) => a + (b - yMean) ** 2, 0);
  const ssRes = residuals.reduce((a, b) => a + b * b, 0);
  const rSquared = 1 - ssRes / ssTot;

  return { beta, se, tStats, residuals, rSquared };
}

/**
 * 行列の逆行列（ガウス・ジョルダン法）
 */
function invertMatrix(A) {
  const n = A.length;
  // 拡大行列 [A|I] を作成
  const aug = [];
  for (let i = 0; i < n; i++) {
    aug[i] = [];
    for (let j = 0; j < n; j++) {
      aug[i][j] = A[i][j];
    }
    for (let j = 0; j < n; j++) {
      aug[i][n + j] = (i === j) ? 1 : 0;
    }
  }

  // 前進消去
  for (let i = 0; i < n; i++) {
    // ピボット選択
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
        maxRow = k;
      }
    }
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

    // 対角要素を 1 に
    const pivot = aug[i][i];
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Matrix is singular or nearly singular');
    }
    for (let j = i; j < 2 * n; j++) {
      aug[i][j] /= pivot;
    }

    // 他の行を消去
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = aug[k][i];
        for (let j = i; j < 2 * n; j++) {
          aug[k][j] -= factor * aug[i][j];
        }
      }
    }
  }

  // 逆行列を抽出
  const inv = [];
  for (let i = 0; i < n; i++) {
    inv[i] = [];
    for (let j = 0; j < n; j++) {
      inv[i][j] = aug[i][n + j];
    }
  }

  return inv;
}

// ============================================================================
// ファクターモデル分析
// ============================================================================

function runStrategy(retUs, retJp, retJpOc, config, labels, CFull) {
  const nJp = retJp[0].values.length;
  const results = [];
  const signalGen = new LeadLagSignal(config);

  for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
    const start = i - config.windowLength;
    const retUsWin = retUs.slice(start, i).map(r => r.values);
    const retJpWin = retJp.slice(start, i).map(r => r.values);
    const retUsLatest = retUs[i].values;
        
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, labels, CFull);
    const weights = buildPortfolio(signal, config.quantile);
        
    const retNext = retJpOc[i].values;
    let stratRet = 0;
    for (let j = 0; j < nJp; j++) {
      stratRet += weights[j] * retNext[j];
    }
        
    results.push({ date: retJpOc[i].date, return: stratRet });
  }

  return results;
}

function analyzeFactorExposure(strategyReturns, factorData, dates) {
  const n = strategyReturns.length;
    
  // ファクターデータを準備
  const y = [];
  const X = [];
    
  for (let i = 0; i < n; i++) {
    const date = dates[i];
    const factor = factorData[date];
        
    if (factor) {
      // 超過リターン（リスクフリーレートを差し引き）
      y.push(strategyReturns[i].return - factor.RF / 252); // 年率→日率
            
      // デザイン行列 [1, MktRF, SMB, HML]
      X.push([1, factor.MktRF, factor.SMB, factor.HML]);
    }
  }

  // 回帰分析
  const { beta, se, tStats, rSquared } = multipleRegression(y, X);

  return {
    alpha: beta[0] * 252, // 年率化
    alphaSE: se[0] * Math.sqrt(252),
    alphaTStat: tStats[0],
    marketBeta: beta[1],
    marketTStat: tStats[1],
    smbBeta: beta[2],
    smbTStat: tStats[2],
    hmlBeta: beta[3],
    hmlTStat: tStats[3],
    rSquared,
    nSamples: y.length
  };
}

function calculateAlphaSharpe(strategyReturns, factorData, dates) {
  // ファクターニュートラルリターン（ファクターエクスポージャーをヘッジ）
  const exposure = analyzeFactorExposure(strategyReturns, factorData, dates);
    
  const hedgedReturns = [];
  for (let i = 0; i < strategyReturns.length; i++) {
    const date = dates[i];
    const factor = factorData[date];
        
    if (factor) {
      const rawRet = strategyReturns[i].return;
      const factorContrib = (
        exposure.marketBeta * factor.MktRF +
                exposure.smbBeta * factor.SMB +
                exposure.hmlBeta * factor.HML
      );
      hedgedReturns.push(rawRet - factorContrib);
    }
  }

  const meanHedged = hedgedReturns.reduce((a, b) => a + b, 0) / hedgedReturns.length;
  const varHedged = hedgedReturns.reduce((a, b) => a + (b - meanHedged) ** 2, 0) / (hedgedReturns.length - 1);
  const stdHedged = Math.sqrt(varHedged);

  return {
    alphaSharpe: (meanHedged * 252) / (stdHedged * Math.sqrt(252)),
    hedgedReturn: meanHedged * 252,
    hedgedRisk: stdHedged * Math.sqrt(252)
  };
}

// ============================================================================
// メイン
// ============================================================================

function main() {
  console.log('='.repeat(70));
  console.log('ファクターモデルリスク分析');
  console.log('Fama-French 3 Factor Model Analysis');
  console.log('='.repeat(70));

  const dataDir = path.join(__dirname, '..', 'data');
  const outputDir = path.join(__dirname, '..', 'results');
    
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // データ読み込み
  console.log('\n[1/4] データ読み込み中...');
  const usData = loadLocalData(dataDir, US_ETF_TICKERS);
  const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

  const usEmpty = US_ETF_TICKERS.filter(t => usData[t].length === 0);
  const jpEmpty = JP_ETF_TICKERS.filter(t => jpData[t].length === 0);

  if (usEmpty.length > 0 || jpEmpty.length > 0) {
    console.error('エラー：データ不足');
    console.error('  最初に `npm run backtest` を実行してください');
    return;
  }

  // ファクターデータ読み込み
  console.log('\n[2/4] ファクターデータ読み込み中...');
  const factorFilePath = FACTOR_DATA_SOURCES.local.path;
  const factorData = loadFactorData(factorFilePath);
  const factorDates = Object.keys(factorData);
  console.log(`  ファクターデータ期間：${factorDates[0]} ~ ${factorDates[factorDates.length - 1]}`);

  // データ処理
  console.log('\n[3/4] データ処理中...');
  const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(
    usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS
  );
  console.log(`  取引日数：${dates.length}, 期間：${dates[0]} ~ ${dates[dates.length - 1]}`);

  if (dates.length < 100) {
    console.error('エラー：データ不足');
    return;
  }

  // 戦略実行
  console.log('\n[4/4] ファクターモデル分析を実行中...');
  const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
    .map((r, i) => [...r.values, ...retJp[i].values]);
  const CFull = correlationMatrixSample(combined);

  const resultsSub = runStrategy(retUs, retJp, retJpOc, BASE_CONFIG, SECTOR_LABELS, CFull);
  const resultsMom = runStrategy(retUs, retJp, retJpOc, { ...BASE_CONFIG, lambdaReg: 0 }, SECTOR_LABELS, CFull);

  // ファクターモデル回帰
  const factorExposureSub = analyzeFactorExposure(resultsSub, factorData, dates.slice(BASE_CONFIG.warmupPeriod));
  const factorExposureMom = analyzeFactorExposure(resultsMom, factorData, dates.slice(BASE_CONFIG.warmupPeriod));

  // アルファ・シャープ比
  const alphaSharpeSub = calculateAlphaSharpe(resultsSub, factorData, dates.slice(BASE_CONFIG.warmupPeriod));
  const alphaSharpeMom = calculateAlphaSharpe(resultsMom, factorData, dates.slice(BASE_CONFIG.warmupPeriod));

  // 結果表示
  console.log('\n' + '='.repeat(70));
  console.log('ファクターモデル分析結果');
  console.log('='.repeat(70));

  console.log('\n【PCA SUB 戦略 - ファクターエクスポージャー】');
  console.log('Factor'.padEnd(15) + 'Beta'.padStart(10) + 't-Stat'.padStart(10) + 'Significant');
  console.log('-'.repeat(50));
  console.log('Alpha (年率)'.padEnd(15) + factorExposureSub.alpha.toFixed(4).padStart(10) + 
                factorExposureSub.alphaTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureSub.alphaTStat) > 2 ? '  ***' : ''));
  console.log('Market (MktRF)'.padEnd(15) + factorExposureSub.marketBeta.toFixed(4).padStart(10) + 
                factorExposureSub.marketTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureSub.marketTStat) > 2 ? '  ***' : ''));
  console.log('SMB (Size)'.padEnd(15) + factorExposureSub.smbBeta.toFixed(4).padStart(10) + 
                factorExposureSub.smbTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureSub.smbTStat) > 2 ? '  ***' : ''));
  console.log('HML (Value)'.padEnd(15) + factorExposureSub.hmlBeta.toFixed(4).padStart(10) + 
                factorExposureSub.hmlTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureSub.hmlTStat) > 2 ? '  ***' : ''));
  console.log(`R-squared: ${(factorExposureSub.rSquared * 100).toFixed(2)}%`);
  console.log(`サンプル数：${factorExposureSub.nSamples}`);

  console.log('\n【MOM 戦略 - ファクターエクスポージャー】');
  console.log('Factor'.padEnd(15) + 'Beta'.padStart(10) + 't-Stat'.padStart(10) + 'Significant');
  console.log('-'.repeat(50));
  console.log('Alpha (年率)'.padEnd(15) + factorExposureMom.alpha.toFixed(4).padStart(10) + 
                factorExposureMom.alphaTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureMom.alphaTStat) > 2 ? '  ***' : ''));
  console.log('Market (MktRF)'.padEnd(15) + factorExposureMom.marketBeta.toFixed(4).padStart(10) + 
                factorExposureMom.marketTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureMom.marketTStat) > 2 ? '  ***' : ''));
  console.log('SMB (Size)'.padEnd(15) + factorExposureMom.smbBeta.toFixed(4).padStart(10) + 
                factorExposureMom.smbTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureMom.smbTStat) > 2 ? '  ***' : ''));
  console.log('HML (Value)'.padEnd(15) + factorExposureMom.hmlBeta.toFixed(4).padStart(10) + 
                factorExposureMom.hmlTStat.toFixed(2).padStart(10) + 
                (Math.abs(factorExposureMom.hmlTStat) > 2 ? '  ***' : ''));
  console.log(`R-squared: ${(factorExposureMom.rSquared * 100).toFixed(2)}%`);
  console.log(`サンプル数：${factorExposureMom.nSamples}`);

  console.log('\n【アルファ・シャープ比（ファクターニュートラル）】');
  console.log('Strategy'.padEnd(15) + 'Alpha Sharpe'.padStart(14) + 'Hedged Return'.padStart(15) + 'Hedged Risk');
  console.log('-'.repeat(60));
  console.log('PCA SUB'.padEnd(15) + alphaSharpeSub.alphaSharpe.toFixed(4).padStart(14) + 
                `${(alphaSharpeSub.hedgedReturn * 100).toFixed(2)}%`.padStart(15) + 
                `${(alphaSharpeSub.hedgedRisk * 100).toFixed(2)}%`);
  console.log('MOM'.padEnd(15) + alphaSharpeMom.alphaSharpe.toFixed(4).padStart(14) + 
                `${(alphaSharpeMom.hedgedReturn * 100).toFixed(2)}%`.padStart(15) + 
                `${(alphaSharpeMom.hedgedRisk * 100).toFixed(2)}%`);

  // 考察
  console.log('\n' + '='.repeat(70));
  console.log('考察');
  console.log('='.repeat(70));

  if (Math.abs(factorExposureSub.alphaTStat) > 2) {
    console.log('✓ PCA ストラテジーのアルファは統計的に有意です（5% 水準）');
  } else {
    console.log('△ PCA ストラテジーのアルファは統計的有意性が弱いです');
  }

  if (Math.abs(factorExposureMom.alphaTStat) > 2) {
    console.log('✓ モメンタムストラテジーのアルファは統計的に有意です（5% 水準）');
  } else {
    console.log('△ モメンタムストラテジーのアルファは統計的有意性が弱いです');
  }

  if (factorExposureSub.rSquared < 0.3) {
    console.log('・R 二乗が低いことから、リターンの大部分はファクターでは説明できません');
    console.log('・これは戦略が独自のアルファソースを持っている可能性を示唆します');
  } else {
    console.log('・R 二乗が高い場合、リターンの大部分はファクターエクスポージャーで説明されます');
  }

  if (Math.abs(factorExposureSub.marketBeta) < 0.3) {
    console.log('・マーケットベータが低いことから、戦略はマーケットニュートラルに近いです');
  }

  // 結果保存
  const factorCSV = `Strategy,Alpha,AlphaSE,AlphaTStat,MarketBeta,SMBBeta,HMLBeta,RSquared,AlphaSharpe
PCA SUB,${factorExposureSub.alpha.toFixed(6)},${factorExposureSub.alphaSE.toFixed(6)},${factorExposureSub.alphaTStat.toFixed(4)},${factorExposureSub.marketBeta.toFixed(6)},${factorExposureSub.smbBeta.toFixed(6)},${factorExposureSub.hmlBeta.toFixed(6)},${factorExposureSub.rSquared.toFixed(6)},${alphaSharpeSub.alphaSharpe.toFixed(6)}
MOM,${factorExposureMom.alpha.toFixed(6)},${factorExposureMom.alphaSE.toFixed(6)},${factorExposureMom.alphaTStat.toFixed(4)},${factorExposureMom.marketBeta.toFixed(6)},${factorExposureMom.smbBeta.toFixed(6)},${factorExposureMom.hmlBeta.toFixed(6)},${factorExposureMom.rSquared.toFixed(6)},${alphaSharpeMom.alphaSharpe.toFixed(6)}`;
  fs.writeFileSync(path.join(outputDir, 'factor_model_analysis.csv'), factorCSV);

  const summaryJSON = JSON.stringify({
    analysisDate: new Date().toISOString().split('T')[0],
    parameters: BASE_CONFIG,
    pcaSub: {
      factorExposure: {
        alpha: factorExposureSub.alpha,
        alphaSE: factorExposureSub.alphaSE,
        alphaTStat: factorExposureSub.alphaTStat,
        marketBeta: factorExposureSub.marketBeta,
        smbBeta: factorExposureSub.smbBeta,
        hmlBeta: factorExposureSub.hmlBeta,
        rSquared: factorExposureSub.rSquared
      },
      alphaSharpe: alphaSharpeSub.alphaSharpe,
      hedgedReturn: alphaSharpeSub.hedgedReturn,
      hedgedRisk: alphaSharpeSub.hedgedRisk
    },
    mom: {
      factorExposure: {
        alpha: factorExposureMom.alpha,
        alphaSE: factorExposureMom.alphaSE,
        alphaTStat: factorExposureMom.alphaTStat,
        marketBeta: factorExposureMom.marketBeta,
        smbBeta: factorExposureMom.smbBeta,
        hmlBeta: factorExposureMom.hmlBeta,
        rSquared: factorExposureMom.rSquared
      },
      alphaSharpe: alphaSharpeMom.alphaSharpe,
      hedgedReturn: alphaSharpeMom.hedgedReturn,
      hedgedRisk: alphaSharpeMom.hedgedRisk
    }
  }, null, 2);
  fs.writeFileSync(path.join(outputDir, 'factor_model_summary.json'), summaryJSON);

  console.log('\n' + '='.repeat(70));
  console.log('結果保存先:');
  console.log(`  - ${path.join(outputDir, 'factor_model_analysis.csv')}`);
  console.log(`  - ${path.join(outputDir, 'factor_model_summary.json')}`);
  console.log('='.repeat(70));

  console.log('\n【注意】');
  console.log('・この分析はダミーファクターデータを使用しています（実際の分析には Fama-French データを使用してください）');
  console.log('・日本株向けには TOPIX ファクターや BARRA ファクターの使用を推奨します');
  console.log('・ファクターデータ取得元：https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html');
}

if (require.main === module) {
  const { createLogger } = require('../lib/logger');
  const logger = createLogger('FactorModelAnalysis');

  main().catch(error => {
    logger.error('Analysis failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { multipleRegression, analyzeFactorExposure, calculateAlphaSharpe };
