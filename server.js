/**
 * 日米業種リードラグ戦略 - Web バックテストサーバー
 * 銘柄選択シグナルをリアルタイムで生成
 */

const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 設定
const CONFIG = {
    windowLength: 60,
    nFactors: 3,
    lambdaReg: 0.9,
    quantile: 0.4,
    warmupPeriod: 60,
};

// 日本セクター ETF
const JP_ETF_TICKERS = [
    '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
    '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
    '1631.T', '1632.T', '1633.T'
];

const JP_ETF_NAMES = {
    '1617.T': '食品', '1618.T': 'エネルギー資源', '1619.T': '建設・資材',
    '1620.T': '素材・化学', '1621.T': '医薬品', '1622.T': '自動車・輸送機',
    '1623.T': '鉄鋼・非鉄', '1624.T': '機械', '1625.T': '電機・精密',
    '1626.T': '情報通信', '1627.T': '電力・ガス', '1628.T': '運輸・物流',
    '1629.T': '商社・卸売', '1630.T': '小売', '1631.T': '銀行',
    '1632.T': '証券・商品', '1633.T': '保険'
};

// 米国セクター ETF
const US_ETF_TICKERS = [
    'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'
];

// セクターラベル
const SECTOR_LABELS = {
    'US_XLB': 'cyclical', 'US_XLE': 'cyclical', 'US_XLF': 'cyclical', 'US_XLRE': 'cyclical',
    'US_XLK': 'defensive', 'US_XLP': 'defensive', 'US_XLU': 'defensive', 'US_XLV': 'defensive',
    'US_XLI': 'cyclical', 'US_XLC': 'neutral', 'US_XLY': 'cyclical',
    'JP_1618.T': 'cyclical', 'JP_1625.T': 'cyclical', 'JP_1629.T': 'cyclical', 'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive', 'JP_1621.T': 'defensive', 'JP_1627.T': 'defensive', 'JP_1630.T': 'defensive',
    'JP_1619.T': 'cyclical', 'JP_1620.T': 'cyclical', 'JP_1622.T': 'cyclical', 'JP_1623.T': 'cyclical',
    'JP_1624.T': 'cyclical', 'JP_1626.T': 'neutral', 'JP_1628.T': 'cyclical', 'JP_1632.T': 'cyclical',
    'JP_1633.T': 'defensive',
};

// 線形代数関数
function transpose(m) { return m[0].map((_, i) => m.map(r => r[i])); }
function dotProduct(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function norm(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function normalize(v) { const n = norm(v); return n > 1e-10 ? v.map(x => x / n) : v; }
function diag(m) { return m.map((r, i) => r[i]); }
function makeDiag(v) {
    const n = v.length;
    const r = new Array(n).fill(0).map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) r[i][i] = v[i];
    return r;
}

function matmul(A, B) {
    const rowsA = A.length, colsA = A[0].length, colsB = B[0].length;
    const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));
    for (let i = 0; i < rowsA; i++)
        for (let j = 0; j < colsB; j++)
            for (let k = 0; k < colsA; k++)
                result[i][j] += A[i][k] * B[k][j];
    return result;
}

function eigenDecposition(matrix, k = 3) {
    const n = matrix.length;
    const eigenvalues = [], eigenvectors = [];
    let A = matrix.map(r => [...r]);
    
    for (let e = 0; e < k; e++) {
        let v = normalize(new Array(n).fill(0).map((_, i) => Math.random()));
        for (let iter = 0; iter < 500; iter++) {
            let vNew = new Array(n).fill(0);
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
    const n = data.length, m = data[0].length;
    const means = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) means[j] += data[i][j];
        means[j] /= n;
    }
    const stds = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
        let ss = 0;
        for (let i = 0; i < n; i++) { const d = data[i][j] - means[j]; ss += d * d; }
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

// PCA クラス
class SubspacePCA {
    constructor(config) { this.config = config; this.C0 = null; }
    
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
        
        const { eigenvectors } = eigenDecposition(CReg, this.config.nFactors);
        return transpose(eigenvectors);
    }
}

class LeadLagSignal {
    constructor(config) { this.config = config; this.pca = new SubspacePCA(config); }
    
    compute(retUs, retJp, retUsLatest, labels, CFull) {
        const nSamples = retUs.length, nUs = retUs[0].length, nJp = retJp[0].length;
        const combined = retUs.map((r, i) => [...r, ...retJp[i]]);
        const N = nUs + nJp;
        
        const mu = new Array(N).fill(0);
        const sigma = new Array(N).fill(0);
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < nSamples; i++) mu[j] += combined[i][j];
            mu[j] /= nSamples;
            let ss = 0;
            for (let i = 0; i < nSamples; i++) { const d = combined[i][j] - mu[j]; ss += d * d; }
            sigma[j] = Math.sqrt(ss / nSamples) + 1e-10;
        }
        
        const std = combined.map(r => r.map((x, j) => (x - mu[j]) / sigma[j]));
        const VK = this.pca.compute(std, labels, CFull);
        
        const VUs = VK.slice(0, nUs), VJp = VK.slice(nUs);
        const zLatest = retUsLatest.map((x, j) => (x - mu[j]) / sigma[j]);
        const fT = VUs.map(v => dotProduct(v, zLatest));
        return VJp.map(v => dotProduct(v, fT));
    }
}

// データ取得
async function fetchData(ticker, days = 200) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        const result = await yahooFinance.chart(ticker, {
            period1: startDate.toISOString().split('T')[0],
            period2: endDate.toISOString().split('T')[0],
            interval: '1d'
        });
        
        return result.quotes
            .filter(q => q.close !== null && q.close > 0)
            .map(q => ({
                date: q.date.toISOString().split('T')[0],
                open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
            }));
    } catch (e) {
        console.error(`Error fetching ${ticker}:`, e.message);
        return [];
    }
}

function computeReturns(ohlc, type = 'cc') {
    if (type === 'cc') {
        const ret = [];
        let prev = null;
        for (const r of ohlc) {
            if (prev !== null) ret.push((r.close - prev) / prev);
            prev = r.close;
        }
        return ret;
    } else {
        return ohlc.filter(r => r.open > 0).map(r => (r.close - r.open) / r.open);
    }
}

// バックテスト API - シンプル版
app.post('/api/backtest', async (req, res) => {
    try {
        const { windowLength, lambdaReg, quantile } = req.body;
        const config = {
            windowLength: parseInt(windowLength) || CONFIG.windowLength,
            nFactors: CONFIG.nFactors,
            lambdaReg: parseFloat(lambdaReg) !== undefined ? parseFloat(lambdaReg) : CONFIG.lambdaReg,
            quantile: parseFloat(quantile) || CONFIG.quantile,
            warmupPeriod: parseInt(windowLength) || CONFIG.windowLength,
        };

        console.log('バックテスト実行中...', config);

        // データ取得
        const usData = {};
        const jpData = {};

        for (const ticker of US_ETF_TICKERS) {
            usData[ticker] = await fetchData(ticker, 500);
        }
        for (const ticker of JP_ETF_TICKERS) {
            jpData[ticker] = await fetchData(ticker, 500);
        }

        // リターン計算
        const usCC = {};
        const jpCC = {};
        const jpOC = {};

        for (const t of US_ETF_TICKERS) usCC[t] = computeReturns(usData[t], 'cc');
        for (const t of JP_ETF_TICKERS) {
            jpCC[t] = computeReturns(jpData[t], 'cc');
            jpOC[t] = computeReturns(jpData[t], 'oc');
        }

        // 日付マップ構築
        const usMap = new Map();
        const jpCCMap = new Map();
        const jpOCMap = new Map();

        US_ETF_TICKERS.forEach(t => {
            usData[t].slice(1).forEach((r, i) => {
                const ret = (r.close - usData[t][i].close) / usData[t][i].close;
                if (!usMap.has(r.date)) usMap.set(r.date, {});
                usMap.get(r.date)[t] = ret;
            });
        });

        JP_ETF_TICKERS.forEach(t => {
            jpData[t].slice(1).forEach((r, i) => {
                const ccRet = (r.close - jpData[t][i].close) / jpData[t][i].close;
                const ocRet = (r.close - r.open) / r.open;
                if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
                jpCCMap.get(r.date)[t] = ccRet;
                if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
                jpOCMap.get(r.date)[t] = ocRet;
            });
        });

        // 共通日付
        const commonDates = [...usMap.keys()].filter(d => jpCCMap.has(d)).sort();

        // 行列入れ
        const retUs = [], retJp = [], retJpOc = [], dates = [];
        for (let i = 1; i < commonDates.length; i++) {
            const usDate = commonDates[i - 1];
            const jpDate = commonDates[i];
            const usRow = US_ETF_TICKERS.map(t => usMap.get(usDate)?.[t]);
            const jpRow = JP_ETF_TICKERS.map(t => jpCCMap.get(jpDate)?.[t]);
            const jpOcRow = JP_ETF_TICKERS.map(t => jpOCMap.get(jpDate)?.[t]);

            if (usRow.some(v => v === null || v === undefined) || 
                jpRow.some(v => v === null || v === undefined) || 
                jpOcRow.some(v => v === null || v === undefined)) continue;

            retUs.push({ date: usDate, values: usRow });
            retJp.push({ date: jpDate, values: jpRow });
            retJpOc.push({ date: jpDate, values: jpOcRow });
            dates.push(jpDate);
        }

        console.log(`バックテスト期間：${dates.length}日`);

        if (dates.length < config.warmupPeriod + 10) {
            return res.json({ 
                error: 'データが不足しています',
                metrics: { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0, Days: dates.length }
            });
        }

        // C_full 計算
        const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
            .map((r, i) => [...r.values, ...retJp[i].values]);
        const CFull = correlationMatrix(combined);

        // シグナル計算
        const signalGen = new LeadLagSignal(config);
        const results = [];

        for (let i = config.warmupPeriod; i < retJpOc.length; i++) {
            const start = i - config.windowLength;
            const retUsWin = retUs.slice(start, i).map(r => r.values);
            const retJpWin = retJp.slice(start, i).map(r => r.values);
            const retUsLatest = retUs[i - 1].values;

            const signal = signalGen.compute(retUsWin, retJpWin, retUsLatest, SECTOR_LABELS, CFull);

            // ポートフォリオ構築
            const n = signal.length;
            const q = Math.max(1, Math.floor(n * config.quantile));
            const indexed = signal.map((v, idx) => ({ val: v, idx }))
                .sort((a, b) => a.val - b.val);

            const longIdx = indexed.slice(-q).map(x => x.idx);
            const shortIdx = indexed.slice(0, q).map(x => x.idx);

            const retNext = retJpOc[i].values;
            let stratRet = 0;

            for (const idx of longIdx) stratRet += retNext[idx] / q;
            for (const idx of shortIdx) stratRet -= retNext[idx] / q;

            results.push({
                date: retJpOc[i].date,
                return: stratRet
            });
        }

        // パフォーマンス指標
        const returns = results.map(r => r.return);
        const ar = returns.reduce((a, b) => a + b, 0) / returns.length * 252;
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
        const risk = Math.sqrt(variance) * Math.sqrt(252);
        const rr = risk > 0 ? ar / risk : 0;

        let cum = 1, rMax = 1, mdd = 0;
        for (const r of returns) {
            cum *= (1 + r);
            if (cum > rMax) rMax = cum;
            const dd = (cum - rMax) / rMax;
            if (dd < mdd) mdd = dd;
        }

        res.json({
            config,
            results: results.slice(-200), // 最新 200 日のみ
            metrics: {
                AR: ar * 100,
                RISK: risk * 100,
                RR: rr,
                MDD: mdd * 100,
                Total: (cum - 1) * 100,
                Days: returns.length
            }
        });

    } catch (e) {
        console.error('バックテストエラー:', e);
        res.status(500).json({ error: e.message, metrics: null });
    }
});

// シグナル生成 API
app.post('/api/signal', async (req, res) => {
    try {
        const { windowLength, lambdaReg, quantile } = req.body;
        const config = {
            windowLength: windowLength || CONFIG.windowLength,
            nFactors: CONFIG.nFactors,
            lambdaReg: lambdaReg !== undefined ? lambdaReg : CONFIG.lambdaReg,
            quantile: quantile || CONFIG.quantile,
        };
        
        console.log('シグナル生成中...', config);
        
        // データ取得
        const usData = {};
        const jpData = {};
        
        for (const ticker of US_ETF_TICKERS) {
            usData[ticker] = await fetchData(ticker, config.windowLength + 50);
        }
        for (const ticker of JP_ETF_TICKERS) {
            jpData[ticker] = await fetchData(ticker, config.windowLength + 50);
        }
        
        // リターン計算
        const usCC = {};
        const jpCC = {};
        
        for (const t of US_ETF_TICKERS) usCC[t] = computeReturns(usData[t], 'cc');
        for (const t of JP_ETF_TICKERS) jpCC[t] = computeReturns(jpData[t], 'cc');
        
        // 行列構築
        const retUs = [], retJp = [];
        const dates = [];
        
        const minLen = Math.min(...Object.values(usCC).map(a => a.length));
        for (let i = 0; i < minLen; i++) {
            const usRow = US_ETF_TICKERS.map(t => usCC[t][i]);
            const jpRow = JP_ETF_TICKERS.map(t => jpCC[t][i]);
            
            if (usRow.some(v => v === null || isNaN(v)) || jpRow.some(v => v === null || isNaN(v))) continue;
            
            retUs.push(usRow);
            retJp.push(jpRow);
            
            const date = usData[US_ETF_TICKERS[0]][i + 1]?.date;
            if (date) dates.push(date);
        }
        
        if (retUs.length < config.windowLength) {
            return res.json({ error: 'データが不足しています', signals: [] });
        }
        
        // C_full 計算
        const combined = retUs.map((r, i) => [...r, ...retJp[i]]);
        const CFull = correlationMatrix(combined);
        
        // 最新シグナル計算
        const signalGen = new LeadLagSignal(config);
        const retUsWin = retUs.slice(-config.windowLength);
        const retJpWin = retJp.slice(-config.windowLength);
        const retUsLatest = retUs[retUs.length - 1];
        
        const signal = signalGen.compute(retUsWin, retJpWin, retUsLatest, SECTOR_LABELS, CFull);
        
        // ランキング作成
        const signals = JP_ETF_TICKERS.map((ticker, i) => ({
            ticker,
            name: JP_ETF_NAMES[ticker] || ticker,
            signal: signal[i],
            rank: 0
        })).sort((a, b) => b.signal - a.signal);
        
        signals.forEach((s, i) => s.rank = i + 1);

        // 価格データを追加取得（楽天証券・1 口から購入可能のため）
        const prices = {};
        for (const ticker of JP_ETF_TICKERS) {
            try {
                const quote = await yahooFinance.quote(ticker);
                prices[ticker] = quote.regularMarketPrice || 0;
            } catch (e) {
                prices[ticker] = 0;
            }
        }

        // 価格情報を追加
        signals.forEach(s => {
            s.price = prices[s.ticker] || 0;
            s.priceFormatted = s.price > 0 ? `${s.price.toLocaleString()}円/口` : 'N/A';
        });

        // 買い候補（上位 30%）
        const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * config.quantile));
        const buyCandidates = signals.slice(0, buyCount);
        
        // 買い候補の価格も追加
        buyCandidates.forEach(s => {
            s.price = prices[s.ticker] || 0;
            s.priceFormatted = s.price > 0 ? `${s.price.toLocaleString()}円/口` : 'N/A';
        });
        
        // 売り候補（下位 30%）
        const sellCandidates = signals.slice(-buyCount);
        
        res.json({
            config,
            signals,
            buyCandidates,
            sellCandidates,
            latestDate: dates[dates.length - 1],
            metrics: {
                meanSignal: signal.reduce((a, b) => a + b, 0) / signal.length,
                stdSignal: Math.sqrt(signal.reduce((a, b) => a + (b - signal.reduce((s, v) => s + v, 0) / signal.length) ** 2, 0) / signal.length)
            }
        });
        
    } catch (e) {
        console.error('シグナルエラー:', e);
        res.status(500).json({ error: e.message });
    }
});

// 設定取得 API
app.get('/api/config', (req, res) => {
    res.json(CONFIG);
});

// 設定更新 API
app.post('/api/config', (req, res) => {
    Object.assign(CONFIG, req.body);
    res.json(CONFIG);
});

app.listen(PORT, () => {
    console.log(`サーバー起動中: http://localhost:${PORT}`);
    console.log(`API エンドポイント:`);
    console.log(`  POST /api/backtest - バックテスト実行`);
    console.log(`  POST /api/signal - シグナル生成`);
    console.log(`  GET  /api/config - 設定取得`);
    console.log(`  POST /api/config - 設定更新`);
});
