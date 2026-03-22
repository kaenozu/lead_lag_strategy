/**
 * 部分空間正則化 PCA・リードラグシグナル（数値コア）
 */

'use strict';

let _eigenSeed = 42;

/** 再現性のための疑似乱数（power iteration 初期ベクトル用） */
function setEigenSeed(seed) {
    _eigenSeed = (Math.floor(Number(seed)) || 42) >>> 0;
}

function eigenRand() {
    _eigenSeed = (_eigenSeed * 1664525 + 1013904223) >>> 0;
    return _eigenSeed / 4294967296;
}

function transpose(m) {
    return m[0].map((_, i) => m.map(r => r[i]));
}

function dotProduct(a, b) {
    return a.reduce((s, v, i) => s + v * b[i], 0);
}

function norm(v) {
    return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function normalize(v) {
    const n = norm(v);
    return n > 1e-10 ? v.map(x => x / n) : v;
}

function diag(m) {
    return m.map((r, i) => r[i]);
}

function makeDiag(v) {
    const n = v.length;
    const r = new Array(n).fill(0).map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) r[i][i] = v[i];
    return r;
}

function matmul(A, B) {
    const rowsA = A.length;
    const colsA = A[0].length;
    const colsB = B[0].length;
    const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));
    for (let i = 0; i < rowsA; i++)
        for (let j = 0; j < colsB; j++)
            for (let k = 0; k < colsA; k++)
                result[i][j] += A[i][k] * B[k][j];
    return result;
}

function eigenDecomposition(matrix, k = 3) {
    const n = matrix.length;
    const eigenvalues = [];
    const eigenvectors = [];
    let A = matrix.map(r => [...r]);

    for (let e = 0; e < k; e++) {
        let v = normalize(new Array(n).fill(0).map(() => eigenRand()));
        for (let iter = 0; iter < 500; iter++) {
            const vNew = new Array(n).fill(0);
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++) vNew[i] += A[i][j] * v[j];
            const nn = norm(vNew);
            if (nn < 1e-10) break;
            v = normalize(vNew);
        }
        const Av = new Array(n).fill(0);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j];
        eigenvalues.push(dotProduct(v, Av));
        eigenvectors.push(v);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++)
                A[i][j] -= eigenvalues[e] * v[i] * v[j];
    }
    return { eigenvalues, eigenvectors };
}

function correlationMatrix(data) {
    const n = data.length;
    const m = data[0].length;
    const means = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) means[j] += data[i][j];
        means[j] /= n;
    }
    const stds = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        let ss = 0;
        for (let i = 0; i < n; i++) {
            const d = data[i][j] - means[j];
            ss += d * d;
        }
        stds[j] = Math.sqrt(ss / n);
    }
    const std = new Array(n).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++)
            std[i][j] = stds[j] > 1e-10 ? (data[i][j] - means[j]) / stds[j] : 0;

    const corr = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++)
        for (let j = 0; j < m; j++) {
            let s = 0;
            for (let k = 0; k < n; k++) s += std[k][i] * std[k][j];
            corr[i][j] = s / n;
        }
    return corr;
}

class SubspacePCA {
    constructor(config) {
        this.config = config;
        this.C0 = null;
    }

    buildPriorSpace(nUs, nJp, labels, CFull) {
        const N = nUs + nJp;
        const keys = Object.keys(labels);

        let v1 = normalize(new Array(N).fill(1));
        let v2 = new Array(N).fill(0);
        for (let i = 0; i < nUs; i++) v2[i] = 1;
        for (let i = nUs; i < N; i++) v2[i] = -1;
        v2 = normalize(v2.map((x, i) => x - dotProduct(v2, v1) * v1[i]));

        let v3 = new Array(N).fill(0);
        for (let i = 0; i < N; i++) {
            if (labels[keys[i]] === 'cyclical') v3[i] = 1;
            else if (labels[keys[i]] === 'defensive') v3[i] = -1;
        }
        v3 = v3.map((x, i) => x - dotProduct(v3, v1) * v1[i] - dotProduct(v3, v2) * v2[i]);
        v3 = normalize(v3);

        const V0 = new Array(N).fill(0).map((_, i) => [v1[i], v2[i], v3[i]]);
        const CFullV0 = matmul(CFull, V0);
        const D0 = diag(matmul(transpose(V0), CFullV0));
        const C0Raw = matmul(matmul(V0, makeDiag(D0)), transpose(V0));
        const delta = diag(C0Raw);
        const inv = delta.map(x => 1 / Math.sqrt(Math.abs(x) + 1e-10));
        let C0 = matmul(matmul(makeDiag(inv), C0Raw), makeDiag(inv));
        for (let i = 0; i < N; i++) C0[i][i] = 1;
        this.C0 = C0;
    }

    compute(returns, labels, CFull) {
        const nUs = Object.keys(labels).filter(k => k.startsWith('US_')).length;
        const nJp = Object.keys(labels).filter(k => k.startsWith('JP_')).length;
        if (!this.C0) this.buildPriorSpace(nUs, nJp, labels, CFull);

        const CT = correlationMatrix(returns);
        const N = CT.length;
        const CReg = new Array(N).fill(0).map(() => new Array(N).fill(0));
        for (let i = 0; i < N; i++)
            for (let j = 0; j < N; j++)
                CReg[i][j] = (1 - this.config.lambdaReg) * CT[i][j] + this.config.lambdaReg * this.C0[i][j];

        const { eigenvectors } = eigenDecomposition(CReg, this.config.nFactors);
        return transpose(eigenvectors);
    }
}

class LeadLagSignal {
    constructor(config) {
        this.config = config;
        this.pca = new SubspacePCA(config);
    }

    compute(retUs, retJp, retUsLatest, labels, CFull) {
        const nSamples = retUs.length;
        const nUs = retUs[0].length;
        const nJp = retJp[0].length;
        const combined = retUs.map((r, i) => [...r, ...retJp[i]]);
        const N = nUs + nJp;

        const mu = new Array(N).fill(0);
        const sigma = new Array(N).fill(0);
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < nSamples; i++) mu[j] += combined[i][j];
            mu[j] /= nSamples;
            let ss = 0;
            for (let i = 0; i < nSamples; i++) {
                const d = combined[i][j] - mu[j];
                ss += d * d;
            }
            sigma[j] = Math.sqrt(ss / nSamples) + 1e-10;
        }

        const std = combined.map(r => r.map((x, j) => (x - mu[j]) / sigma[j]));
        const VK = this.pca.compute(std, labels, CFull);

        const VUs = VK.slice(0, nUs);
        const VJp = VK.slice(nUs);
        const zLatest = retUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        const fT = VUs.map(v => dotProduct(v, zLatest));
        return VJp.map(v => dotProduct(v, fT));
    }
}

module.exports = {
    setEigenSeed,
    transpose,
    dotProduct,
    norm,
    normalize,
    diag,
    makeDiag,
    matmul,
    eigenDecomposition,
    correlationMatrix,
    SubspacePCA,
    LeadLagSignal,
};
