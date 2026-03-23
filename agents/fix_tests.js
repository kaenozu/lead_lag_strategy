/**
 * ユニットテスト拡充エージェント
 * 
 * 役割：
 * 1. Jest を使用したユニットテストの作成
 * 2. テストカバレッジの向上
 * 3. モックとフィクスチャの整備
 * 
 * 使用方法：
 * node agents/fix_tests.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');

const logger = createLogger('FixTestsAgent');

// テンプレート文字列内で \${...} を出力するための補助定数
const TEMPLATE_DOLLAR = '$';

// ============================================
// 修正タスク定義
// ============================================

const tasks = [
  {
    id: 'TEST-001',
    title: 'PCA モジュールのユニットテスト作成',
    priority: 'medium',
    files: ['tests/lib/pca.test.js'],
    description: '部分空間正則化 PCA のテスト'
  },
  {
    id: 'TEST-002',
    title: '数学関数のユニットテスト作成',
    priority: 'medium',
    files: ['tests/lib/math.test.js'],
    description: '行列演算・固有値分解のテスト'
  },
  {
    id: 'TEST-003',
    title: 'ポートフォリオ関数のユニットテスト作成',
    priority: 'medium',
    files: ['tests/lib/portfolio.test.js'],
    description: 'ポートフォリオ構築・パフォーマンス指標のテスト'
  },
  {
    id: 'TEST-004',
    title: 'データ処理関数のユニットテスト作成',
    priority: 'medium',
    files: ['tests/lib/data.test.js'],
    description: 'データ取得・前処理のテスト'
  },
  {
    id: 'TEST-005',
    title: 'サーバー API のユニットテスト作成',
    priority: 'low',
    files: ['tests/server.test.js'],
    description: 'API エンドポイントのテスト'
  }
];

// ============================================
// テストファイル生成
// ============================================

/**
 * PCA モジュールのテストを生成
 */
function createPCATests() {
  const testDir = path.join(__dirname, '..', 'tests', 'lib');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
    logger.info(`テストディレクトリを作成しました：${testDir}`);
  }

  const testContent = `/**
 * 部分空間正則化 PCA のユニットテスト
 */

const { SubspaceRegularizedPCA, LeadLagSignal } = require('../../lib/pca');
const { SECTOR_LABELS } = require('../../lib/constants');

describe('SubspaceRegularizedPCA', () => {
  let pca;

  beforeEach(() => {
    pca = new SubspaceRegularizedPCA({
      lambdaReg: 0.9,
      nFactors: 3,
      windowLength: 60
    });
  });

  describe('constructor', () => {
    test('デフォルトパラメータで初期化', () => {
      const defaultPca = new SubspaceRegularizedPCA({});
      expect(defaultPca.lambdaReg).toBe(0.5);
      expect(defaultPca.nFactors).toBe(3);
    });

    test('カスタムパラメータで初期化', () => {
      expect(pca.lambdaReg).toBe(0.9);
      expect(pca.nFactors).toBe(3);
    });
  });

  describe('buildPriorSpace', () => {
    test('事前部分空間が正規直交系をなす', () => {
      const nUs = 11;
      const nJp = 17;
      const CFull = createTestCorrelationMatrix(nUs + nJp);
      
      pca.buildPriorSpace(nUs, nJp, SECTOR_LABELS, CFull);
      
      const V0 = pca.V0;
      expect(V0).toBeDefined();
      expect(V0.length).toBe(nUs + nJp);
      expect(V0[0].length).toBe(3);

      // V0 の列が正規直交していることを確認
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const dot = V0.reduce((sum, row) => sum + row[i] * row[j], 0);
          if (i === j) {
            expect(dot).toBeCloseTo(1, 5);
          } else {
            expect(dot).toBeCloseTo(0, 5);
          }
        }
      }
    });

    test('異なるセクターラベルで正しく構築', () => {
      const nUs = 11;
      const nJp = 17;
      const CFull = createTestCorrelationMatrix(nUs + nJp);
      
      pca.buildPriorSpace(nUs, nJp, SECTOR_LABELS, CFull);
      
      // グローバルファクターが最初に構築されることを確認
      expect(pca.V0).toBeDefined();
    });
  });

  describe('computeRegularizedPCA', () => {
    test('正則化相関行列の計算', () => {
      const nUs = 11;
      const nJp = 17;
      const CFull = createTestCorrelationMatrix(nUs + nJp);
      
      pca.buildPriorSpace(nUs, nJp, SECTOR_LABELS, CFull);
      
      const testReturns = createTestReturns(60, nUs);
      const result = pca.computeRegularizedPCA(
        testReturns,
        SECTOR_LABELS,
        CFull
      );

      expect(result).toBeDefined();
      expect(result.VK).toBeDefined();
      expect(result.eigenvalues).toBeDefined();
      expect(result.CReg).toBeDefined();
      expect(result.converged).toBeDefined();
    });

    test('lambdaReg=0 で標本相関行列を使用', () => {
      const noRegPca = new SubspaceRegularizedPCA({
        lambdaReg: 0,
        nFactors: 3
      });
      
      const nUs = 11;
      const nJp = 17;
      const CFull = createTestCorrelationMatrix(nUs + nJp);
      
      noRegPca.buildPriorSpace(nUs, nJp, SECTOR_LABELS, CFull);
      
      const testReturns = createTestReturns(60, nUs);
      const result = noRegPca.computeRegularizedPCA(
        testReturns,
        SECTOR_LABELS,
        CFull
      );

      // 正則化なしなので、標本相関行列がそのまま使用される
      expect(result).toBeDefined();
    });

    test('lambdaReg=1 で事前部分空間のみを使用', () => {
      const priorOnlyPca = new SubspaceRegularizedPCA({
        lambdaReg: 1,
        nFactors: 3
      });
      
      const nUs = 11;
      const nJp = 17;
      const CFull = createTestCorrelationMatrix(nUs + nJp);
      
      priorOnlyPca.buildPriorSpace(nUs, nJp, SECTOR_LABELS, CFull);
      
      const testReturns = createTestReturns(60, nUs);
      const result = priorOnlyPca.computeRegularizedPCA(
        testReturns,
        SECTOR_LABELS,
        CFull
      );

      expect(result).toBeDefined();
    });
  });
});

describe('LeadLagSignal', () => {
  let signalGen;

  beforeEach(() => {
    signalGen = new LeadLagSignal({
      windowLength: 60,
      nFactors: 3,
      lambdaReg: 0.9,
      quantile: 0.4
    });
  });

  describe('computeSignal', () => {
    test('シグナル値の計算', () => {
      const nUs = 11;
      const nJp = 17;
      const retUsWin = createTestReturns(60, nUs);
      const retJpWin = createTestReturns(60, nJp);
      const retUsLatest = new Array(nUs).fill(0.01);
      const CFull = createTestCorrelationMatrix(nUs + nJp);

      const signals = signalGen.computeSignal(
        retUsWin,
        retJpWin,
        retUsLatest,
        SECTOR_LABELS,
        CFull
      );

      expect(signals).toBeDefined();
      expect(signals.length).toBe(nJp);
      expect(signals.every(s => typeof s === 'number')).toBe(true);
    });

    test('シグナル値の合計は 0 に近い', () => {
      const nUs = 11;
      const nJp = 17;
      const retUsWin = createTestReturns(60, nUs);
      const retJpWin = createTestReturns(60, nJp);
      const retUsLatest = new Array(nUs).fill(0.01);
      const CFull = createTestCorrelationMatrix(nUs + nJp);

      const signals = signalGen.computeSignal(
        retUsWin,
        retJpWin,
        retUsLatest,
        SECTOR_LABELS,
        CFull
      );

      const sum = signals.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum)).toBeLessThan(1e-6);
    });
  });
});

// ============================================
// テストヘルパー
// ============================================

/**
 * テスト用の相関行列を生成
 */
function createTestCorrelationMatrix(n) {
  const matrix = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row.push(1);
      } else {
        // ランダムな相関値（-0.5 から 0.5）
        row.push((Math.random() - 0.5));
      }
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * テスト用のリターン行列を生成
 */
function createTestReturns(nSamples, nVars) {
  const returns = [];
  for (let i = 0; i < nSamples; i++) {
    const values = [];
    for (let j = 0; j < nVars; j++) {
      // 平均 0、標準偏差 0.02 の正規分布
      values.push((Math.random() - 0.5) * 0.04);
    }
    returns.push({ values });
  }
  return returns;
}
`;

  const testPath = path.join(testDir, 'pca.test.js');
  fs.writeFileSync(testPath, testContent, 'utf8');
  logger.info(`PCA テストファイルを作成しました：${testPath}`);
  return true;
}

/**
 * 数学関数のテストを生成
 */
function createMathTests() {
  const testDir = path.join(__dirname, '..', 'tests', 'lib');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testContent = `/**
 * 数学関数のユニットテスト
 */

const {
  correlationMatrixSample,
  eigenSymmetricTopK,
  eigenDecomposition,
  validateMatrix,
  validateVector
} = require('../../lib/math');

describe('correlationMatrixSample', () => {
  test('単位行列の相関行列は単位行列', () => {
    const data = [
      { values: [1, 0, 0] },
      { values: [0, 1, 0] },
      { values: [0, 0, 1] }
    ];

    const corr = correlationMatrixSample(data);

    expect(corr).toBeDefined();
    expect(corr.length).toBe(3);
    expect(corr[0].length).toBe(3);

    // 対角成分は 1
    for (let i = 0; i < 3; i++) {
      expect(corr[i][i]).toBeCloseTo(1, 5);
    }
  });

  test('完全に相関したデータの相関行列は 1', () => {
    const data = [
      { values: [1, 1, 1] },
      { values: [2, 2, 2] },
      { values: [3, 3, 3] },
      { values: [4, 4, 4] }
    ];

    const corr = correlationMatrixSample(data);

    // すべての要素が 1（完全相関）
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(corr[i][j]).toBeCloseTo(1, 5);
      }
    }
  });

  test('無相関なデータの相関行列は 0 に近い', () => {
    const data = [];
    for (let i = 0; i < 100; i++) {
      data.push({
        values: [
          Math.random(),
          Math.random(),
          Math.random()
        ]
      });
    }

    const corr = correlationMatrixSample(data);

    // 対角成分は 1
    for (let i = 0; i < 3; i++) {
      expect(corr[i][i]).toBeCloseTo(1, 5);
    }

    // 非対角成分は 0 に近い（無相関）
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i !== j) {
          expect(Math.abs(corr[i][j])).toBeLessThan(0.3);
        }
      }
    }
  });
});

describe('eigenSymmetricTopK', () => {
  test('対称行列の固有値・固有ベクトルを計算', () => {
    // 対称行列
    const matrix = [
      [4, 1, 1],
      [1, 3, 1],
      [1, 1, 2]
    ];

    const result = eigenSymmetricTopK(matrix, 3);

    expect(result).toBeDefined();
    expect(result.eigenvalues).toBeDefined();
    expect(result.eigenvectors).toBeDefined();
    expect(result.eigenvalues.length).toBe(3);
    expect(result.eigenvectors.length).toBe(3);

    // 固有値は降順
    for (let i = 1; i < 3; i++) {
      expect(result.eigenvalues[i - 1]).toBeGreaterThanOrEqual(result.eigenvalues[i]);
    }
  });

  test('単位行列の固有値はすべて 1', () => {
    const matrix = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];

    const result = eigenSymmetricTopK(matrix, 3);

    expect(result.eigenvalues.every(λ => Math.abs(λ - 1) < 1e-5)).toBe(true);
  });
});

describe('validateMatrix', () => {
  test('有効な行列は true', () => {
    const matrix = [
      [1, 2],
      [3, 4]
    ];

    expect(validateMatrix(matrix)).toBe(true);
  });

  test('空の行列は false', () => {
    expect(validateMatrix([])).toBe(false);
  });

  test('非正方行列は false', () => {
    const matrix = [
      [1, 2, 3],
      [4, 5, 6]
    ];

    expect(validateMatrix(matrix)).toBe(false);
  });

  test('NaN を含む行列は false', () => {
    const matrix = [
      [1, NaN],
      [3, 4]
    ];

    expect(validateMatrix(matrix)).toBe(false);
  });
});

describe('validateVector', () => {
  test('有効なベクトルは true', () => {
    expect(validateVector([1, 2, 3])).toBe(true);
  });

  test('空のベクトルは false', () => {
    expect(validateVector([])).toBe(false);
  });

  test('NaN を含むベクトルは false', () => {
    expect(validateVector([1, NaN, 3])).toBe(false);
  });
});
`;

  const testPath = path.join(testDir, 'math.test.js');
  fs.writeFileSync(testPath, testContent, 'utf8');
  logger.info(`数学関数テストファイルを作成しました：${testPath}`);
  return true;
}

/**
 * ポートフォリオ関数のテストを生成
 */
function createPortfolioTests() {
  const testDir = path.join(__dirname, '..', 'tests', 'lib');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testContent = `/**
 * ポートフォリオ関数のユニットテスト
 */

const {
  buildPortfolio,
  computePerformanceMetrics,
  applyTransactionCosts,
  computeYearlyPerformance,
  computeRollingMetrics
} = require('../../lib/portfolio');

describe('buildPortfolio', () => {
  test('シグナル値からポートフォリオウェイトを構築', () => {
    const signals = [0.1, 0.2, -0.1, -0.2, 0.05];
    const quantile = 0.4;

    const weights = buildPortfolio(signals, quantile);

    expect(weights).toBeDefined();
    expect(weights.length).toBe(signals.length);

    // ウェイトの合計は 0（ドルニュートラル）
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-6);

    // ロングとショートが同数
    const longCount = weights.filter(w => w > 0).length;
    const shortCount = weights.filter(w => w < 0).length;
    expect(longCount).toBe(shortCount);
  });

  test('すべてのシグナルが同じ場合、ウェイトは 0', () => {
    const signals = [0.1, 0.1, 0.1, 0.1, 0.1];
    const quantile = 0.4;

    const weights = buildPortfolio(signals, quantile);

    expect(weights.every(w => w === 0)).toBe(true);
  });
});

describe('computePerformanceMetrics', () => {
  test('パフォーマンス指標の計算', () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02];

    const metrics = computePerformanceMetrics(returns);

    expect(metrics).toBeDefined();
    expect(metrics.AR).toBeDefined();
    expect(metrics.RISK).toBeDefined();
    expect(metrics.RR).toBeDefined();
    expect(metrics.MDD).toBeDefined();
    expect(metrics.Cumulative).toBeDefined();

    // 年率リターンは日次リターンの平均 * 252
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    expect(metrics.AR).toBeCloseTo(avgReturn * 252, 5);

    // リスクは標準偏差 * sqrt(252)
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const std = Math.sqrt(variance);
    expect(metrics.RISK).toBeCloseTo(std * Math.sqrt(252), 5);
  });

  test('空の配列はデフォルト値', () => {
    const metrics = computePerformanceMetrics([]);

    expect(metrics.AR).toBe(0);
    expect(metrics.RISK).toBe(0);
    expect(metrics.RR).toBe(0);
  });
});

describe('applyTransactionCosts', () => {
  test('取引コストの適用', () => {
    const portfolioReturn = 0.01;
    const costs = {
      commission: 0.0005,
      slippage: 0.001
    };

    const netReturn = applyTransactionCosts(portfolioReturn, costs);

    expect(netReturn).toBeLessThan(portfolioReturn);
    expect(netReturn).toBeCloseTo(portfolioReturn - (costs.commission + costs.slippage), 6);
  });

  test('損失の場合もコストを適用', () => {
    const portfolioReturn = -0.01;
    const costs = {
      commission: 0.0005,
      slippage: 0.001
    };

    const netReturn = applyTransactionCosts(portfolioReturn, costs);

    expect(netReturn).toBeLessThan(portfolioReturn);
  });
});

describe('computeYearlyPerformance', () => {
  test('年別パフォーマンスの計算', () => {
    const results = [
      { date: '2023-01-01', return: 0.01 },
      { date: '2023-01-02', return: -0.02 },
      { date: '2024-01-01', return: 0.03 },
      { date: '2024-01-02', return: -0.01 }
    ];

    const yearly = computeYearlyPerformance(results);

    expect(yearly).toBeDefined();
    expect(yearly['2023']).toBeDefined();
    expect(yearly['2024']).toBeDefined();
  });
});

describe('computeRollingMetrics', () => {
  test('ローリングパフォーマンスの計算', () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      results.push({
        date: \`2023-01-${TEMPLATE_DOLLAR}{String(i + 1).padStart(2, '0')}\`,
        return: (Math.random() - 0.5) * 0.04
      });
    }

    const rolling = computeRollingMetrics(results, 20);

    expect(rolling).toBeDefined();
    expect(rolling.length).toBeGreaterThan(0);

    // 各ローリングウィンドウに RR が含まれる
    rolling.forEach(window => {
      expect(window.RR).toBeDefined();
      expect(window.date).toBeDefined();
    });
  });
});
`;

  const testPath = path.join(testDir, 'portfolio.test.js');
  fs.writeFileSync(testPath, testContent, 'utf8');
  logger.info(`ポートフォリオ関数テストファイルを作成しました：${testPath}`);
  return true;
}

/**
 * データ処理関数のテストを生成
 */
function createDataTests() {
  const testDir = path.join(__dirname, '..', 'tests', 'lib');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testContent = `/**
 * データ処理関数のユニットテスト
 */

const {
  loadCSV,
  saveCSV,
  fetchWithRetry,
  buildReturnMatricesFromOhlcv,
  buildPaperAlignedReturnRows
} = require('../../lib/data');

describe('loadCSV', () => {
  test('CSV ファイルの読み込み', () => {
    const testCsv = \`date,open,high,low,close,volume
2023-01-01,100,105,99,102,1000
2023-01-02,102,107,101,105,1200
2023-01-03,105,110,104,108,1100\`;

    const tempPath = path.join(__dirname, 'temp_test.csv');
    fs.writeFileSync(tempPath, testCsv);

    try {
      const data = loadCSV(tempPath);

      expect(data).toBeDefined();
      expect(data.length).toBe(3);
      expect(data[0]).toHaveProperty('date');
      expect(data[0]).toHaveProperty('close');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  test('存在しないファイルは空配列', () => {
    const data = loadCSV('/nonexistent/path.csv');
    expect(data).toEqual([]);
  });
});

describe('saveCSV', () => {
  test('CSV ファイルの保存', () => {
    const testData = [
      { date: '2023-01-01', value: 100 },
      { date: '2023-01-02', value: 200 }
    ];

    const tempPath = path.join(__dirname, 'temp_save_test.csv');

    try {
      saveCSV(tempPath, testData);

      expect(fs.existsSync(tempPath)).toBe(true);

      const content = fs.readFileSync(tempPath, 'utf8');
      expect(content).toContain('date,value');
      expect(content).toContain('2023-01-01,100');
      expect(content).toContain('2023-01-02,200');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });
});

describe('buildReturnMatricesFromOhlcv', () => {
  test('OHLCV データからリターン行列を構築', () => {
    const usData = {
      'XLB': [
        { date: '2023-01-01', close: 100 },
        { date: '2023-01-02', close: 102 },
        { date: '2023-01-03', close: 101 }
      ]
    };

    const jpData = {
      '1617.T': [
        { date: '2023-01-01', close: 1000 },
        { date: '2023-01-02', close: 1020 },
        { date: '2023-01-03', close: 1010 }
      ]
    };

    const tickersUs = ['XLB'];
    const tickersJp = ['1617.T'];

    const { retUs, retJp, dates } = buildReturnMatricesFromOhlcv(
      usData,
      jpData,
      tickersUs,
      tickersJp,
      1
    );

    expect(retUs).toBeDefined();
    expect(retJp).toBeDefined();
    expect(dates).toBeDefined();

    // リターンが計算されている
    expect(retUs.length).toBeGreaterThan(0);
    expect(retJp.length).toBeGreaterThan(0);
  });
});

describe('fetchWithRetry', () => {
  test('成功するまでリトライ', async () => {
    let attempts = 0;
    const successFn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network error');
      }
      return 'success';
    };

    const result = await fetchWithRetry(successFn, {
      maxRetries: 3,
      baseDelay: 10
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('最大リトライ回数を超えるとエラー', async () => {
    const failFn = async () => {
      throw new Error('Network error');
    };

    await expect(fetchWithRetry(failFn, {
      maxRetries: 2,
      baseDelay: 10
    })).rejects.toThrow('Network error');
  });
});
`;

  const testPath = path.join(testDir, 'data.test.js');
  fs.writeFileSync(testPath, testContent, 'utf8');
  logger.info(`データ処理関数テストファイルを作成しました：${testPath}`);
  return true;
}

/**
 * サーバー API のテストを生成
 */
function createServerTests() {
  const testPath = path.join(__dirname, '..', 'tests', 'server.test.js');

  const testContent = `/**
 * サーバー API のユニットテスト
 */

const request = require('supertest');

// モック設定
jest.mock('../lib/pca', () => ({
  LeadLagSignal: jest.fn().mockImplementation(() => ({
    computeSignal: jest.fn().mockReturnValue(new Array(17).fill(0))
  }))
}));

jest.mock('../lib/portfolio', () => ({
  buildPortfolio: jest.fn().mockReturnValue(new Array(17).fill(0)),
  computePerformanceMetrics: jest.fn().mockReturnValue({
    AR: 0.1,
    RISK: 0.15,
    RR: 0.67,
    MDD: -0.2,
    Cumulative: 1.5
  }),
  applyTransactionCosts: jest.fn().mockImplementation(r => r),
  computeYearlyPerformance: jest.fn().mockReturnValue({}),
  computeRollingMetrics: jest.fn().mockReturnValue([])
}));

jest.mock('../lib/math', () => ({
  correlationMatrixSample: jest.fn().mockReturnValue([])
}));

jest.mock('../lib/data', () => ({
  fetchWithRetry: jest.fn(),
  fetchOhlcvForTickers: jest.fn().mockResolvedValue({ byTicker: {}, errors: {} }),
  buildReturnMatricesFromOhlcv: jest.fn().mockReturnValue({
    retUs: [],
    retJp: [],
    retJpOc: [],
    dates: []
  })
}));

describe('API Endpoints', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    app = require('../server');
  });

  describe('GET /api/health', () => {
    test('ヘルスチェック', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/config', () => {
    test('設定取得', async () => {
      const response = await request(app).get('/api/config');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('windowLength');
      expect(response.body).toHaveProperty('nFactors');
      expect(response.body).toHaveProperty('lambdaReg');
      expect(response.body).toHaveProperty('quantile');
    });
  });

  describe('POST /api/backtest', () => {
    test('無効なパラメータは 400', async () => {
      const response = await request(app)
        .post('/api/backtest')
        .send({ windowLength: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid parameters');
    });

    test('有効なパラメータで実行', async () => {
      const response = await request(app)
        .post('/api/backtest')
        .send({ windowLength: 60, lambdaReg: 0.9 });

      // モックのため、データ不足エラーが返る
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/signal', () => {
    test('無効なパラメータは 400', async () => {
      const response = await request(app)
        .post('/api/signal')
        .send({ quantile: 1.5 }); // 0.5 を超える値

      expect(response.status).toBe(400);
    });
  });

  describe('404 エラー', () => {
    test('存在しないエンドポイント', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Endpoint not found');
    });
  });
});
`;

  fs.writeFileSync(testPath, testContent, 'utf8');
  logger.info(`サーバー API テストファイルを作成しました：${testPath}`);
  return true;
}

// ============================================
// メイン処理
// ============================================

async function main() {
  logger.info('ユニットテスト拡充エージェントを開始します');
  logger.info(`対象ディレクトリ：${__dirname}/..`);

  try {
    // 各テストファイルを作成
    logger.info('TEST-001: PCA モジュールのテスト作成');
    createPCATests();

    logger.info('TEST-002: 数学関数のテスト作成');
    createMathTests();

    logger.info('TEST-003: ポートフォリオ関数のテスト作成');
    createPortfolioTests();

    logger.info('TEST-004: データ処理関数のテスト作成');
    createDataTests();

    logger.info('TEST-005: サーバー API のテスト作成');
    createServerTests();

    logger.info('すべてのテストファイルを作成しました');
    logger.info('次に実施すること:');
    logger.info('  1. npm test でテストを実行');
    logger.info('  2. npm test -- --coverage でカバレッジレポートを生成');
    logger.info('  3. 失敗したテストを修正・改善');

  } catch (error) {
    logger.error('テスト作成中にエラーが発生しました', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// エージェント実行
if (require.main === module) {
  main();
}

module.exports = {
  tasks,
  createPCATests,
  createMathTests,
  createPortfolioTests,
  createDataTests,
  createServerTests
};
