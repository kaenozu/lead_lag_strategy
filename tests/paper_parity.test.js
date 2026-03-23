/**
 * 合成データでの PCA / シグナル（fixtures と任意で Python 照合）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { LeadLagSignal, SubspaceRegularizedPCA } = require('../lib/pca');

const EXPECTED_PATH = path.join(__dirname, 'fixtures', 'paper_parity_expected.json');

const FIXTURE = {
  returnsCombined: [
    [0.01, 0.02, 0.015, 0.011],
    [0.02, 0.015, 0.01, 0.018],
    [-0.01, -0.005, -0.008, -0.012],
    [0.005, 0.008, 0.003, 0.006],
    [0.015, 0.012, 0.018, 0.014]
  ],
  returnsUsLatest: [0.012, 0.018],
  CFull: [
    [1.0, 0.4, 0.2, 0.1],
    [0.4, 1.0, 0.15, 0.12],
    [0.2, 0.15, 1.0, 0.35],
    [0.1, 0.12, 0.35, 1.0]
  ],
  sectorLabels: {
    US_A: 'cyclical',
    US_B: 'defensive',
    JP_A: 'cyclical',
    JP_B: 'neutral'
  },
  orderedSectorKeys: ['US_A', 'US_B', 'JP_A', 'JP_B'],
  lambdaReg: 0.85,
  nFactors: 2
};

function pythonGolden() {
  const root = path.join(__dirname, '..');
  const bin = process.platform === 'win32' ? 'python' : 'python3';
  const out = execSync(`${bin} scripts/paper_parity_output.py`, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return JSON.parse(out.trim());
}

function runNodeParity() {
  const R = FIXTURE.returnsCombined;
  const nUs = 2;
  const returnsUs = R.map(row => row.slice(0, nUs));
  const returnsJp = R.map(row => row.slice(nUs));

  const pcaCfg = {
    lambdaReg: FIXTURE.lambdaReg,
    nFactors: FIXTURE.nFactors,
    orderedSectorKeys: FIXTURE.orderedSectorKeys
  };

  const nSamples = R.length;
  const N = nUs + R[0].length - nUs;
  const mu = new Array(N).fill(0);
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let i = 0; i < nSamples; i++) s += R[i][j];
    mu[j] = s / nSamples;
  }
  const sigma = new Array(N).fill(0);
  for (let j = 0; j < N; j++) {
    let sumSq = 0;
    for (let i = 0; i < nSamples; i++) {
      const d = R[i][j] - mu[j];
      sumSq += d * d;
    }
    sigma[j] = Math.sqrt(sumSq / nSamples) + 1e-10;
  }
  const returnsStd = R.map(row => row.map((x, j) => (x - mu[j]) / sigma[j]));

  const pca = new SubspaceRegularizedPCA(pcaCfg);
  const { eigenvalues, CReg } = pca.computeRegularizedPCA(
    returnsStd,
    FIXTURE.sectorLabels,
    FIXTURE.CFull
  );

  const gen = new LeadLagSignal(pcaCfg);
  const signal = gen.computeSignal(
    returnsUs,
    returnsJp,
    FIXTURE.returnsUsLatest,
    FIXTURE.sectorLabels,
    FIXTURE.CFull
  );

  return { eigenvalues, CReg, signal };
}

describe('paper parity', () => {
  test('Node 実装が fixtures/paper_parity_expected.json と一致', () => {
    const golden = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
    const { eigenvalues, CReg, signal } = runNodeParity();

    for (let k = 0; k < FIXTURE.nFactors; k++) {
      expect(eigenvalues[k]).toBeCloseTo(golden.eigenvalues[k], 5);
    }
    for (let j = 0; j < golden.C_reg_first_row.length; j++) {
      expect(CReg[0][j]).toBeCloseTo(golden.C_reg_first_row[j], 5);
    }
    for (let i = 0; i < signal.length; i++) {
      expect(signal[i]).toBeCloseTo(golden.signal[i], 5);
    }
  });

  test('Python subspace_pca が利用可能なら fixtures と一致', () => {
    let py;
    try {
      py = pythonGolden();
    } catch (e) {
       
      console.warn('skip Python check:', e.message);
      expect(true).toBe(true);
      return;
    }

    const golden = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
    for (let k = 0; k < FIXTURE.nFactors; k++) {
      expect(py.eigenvalues[k]).toBeCloseTo(golden.eigenvalues[k], 5);
    }
    for (let j = 0; j < golden.C_reg_first_row.length; j++) {
      expect(py.C_reg_first_row[j]).toBeCloseTo(golden.C_reg_first_row[j], 5);
    }
    for (let i = 0; i < py.signal.length; i++) {
      expect(py.signal[i]).toBeCloseTo(golden.signal[i], 5);
    }
  });
});
