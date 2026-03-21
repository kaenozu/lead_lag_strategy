/**
 * 日米業種リードラグ戦略 - Web バックテストサーバー
 * 銘柄選択シグナルをリアルタイムで生成
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { correlationMatrix, LeadLagSignal } = require('./lib/lead_lag_core');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES, SECTOR_LABELS } = require('./sector_constants');

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

function parseIntFinite(v, fallback) {
    const x = parseInt(v, 10);
    return Number.isFinite(x) ? x : fallback;
}

function parseFloatFinite(v, fallback) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : fallback;
}

let lastHeavyApiAt = 0;
const HEAVY_API_MIN_MS = 2500;

function allowHeavyApi(res) {
    const now = Date.now();
    if (now - lastHeavyApiAt < HEAVY_API_MIN_MS) {
        const wait = Math.ceil((HEAVY_API_MIN_MS - (now - lastHeavyApiAt)) / 1000);
        res.status(429).json({ error: 'リクエストが多すぎます。しばらく待ってから再試行してください。', retryAfterSec: wait });
        return false;
    }
    lastHeavyApiAt = now;
    return true;
}

/** CLI（generate_signal）用ローカル CSV の有無・鮮度。Web のシグナル API は Yahoo 直取得。 */
function getLocalDataStatus() {
    const dataDir = path.join(__dirname, 'data');
    const need = [...new Set([...US_ETF_TICKERS, ...JP_ETF_TICKERS])];
    const expected = need.length;
    const out = {
        webSignalSource: 'yahoo_finance_live',
        dataDirExists: false,
        expectedCsv: expected,
        presentCsv: 0,
        missingTickers: [],
        newestMtimeMs: null,
        newestIso: null,
        newestTicker: null,
        hintJa: null,
    };
    if (!fs.existsSync(dataDir)) {
        out.hintJa =
            'ターミナルで npm run setup を実行すると data/ に CSV が保存されます（generate_signal 用）。この画面のシグナルは Yahoo を都度参照します。';
        return out;
    }
    out.dataDirExists = true;
    const missing = [];
    let newest = { ms: 0, ticker: null };
    for (const t of need) {
        const f = path.join(dataDir, `${t}.csv`);
        if (!fs.existsSync(f)) {
            missing.push(t);
            continue;
        }
        out.presentCsv += 1;
        const st = fs.statSync(f);
        if (st.mtimeMs > newest.ms) newest = { ms: st.mtimeMs, ticker: t };
    }
    out.missingTickers = missing;
    if (newest.ms > 0) {
        out.newestMtimeMs = newest.ms;
        out.newestIso = new Date(newest.ms).toISOString();
        out.newestTicker = newest.ticker;
    }
    const ageDays = newest.ms > 0 ? (Date.now() - newest.ms) / (86400 * 1000) : null;
    if (missing.length > 0) {
        out.hintJa = `data/ に CSV が ${missing.length} 本足りません。npm run doctor で確認し、npm run setup を試してください。`;
    } else if (ageDays != null && ageDays > 5) {
        out.hintJa =
            'ローカル CSV の更新から 5 日以上経っています。CLI を使う場合は npm run setup の再実行を検討してください。';
    }
    return out;
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
        if (!allowHeavyApi(res)) return;
        const { windowLength, lambdaReg, quantile } = req.body;
        const wl = parseIntFinite(windowLength, CONFIG.windowLength);
        const config = {
            windowLength: wl,
            nFactors: CONFIG.nFactors,
            lambdaReg: parseFloatFinite(lambdaReg, CONFIG.lambdaReg),
            quantile: parseFloatFinite(quantile, CONFIG.quantile),
            warmupPeriod: wl,
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
        if (!allowHeavyApi(res)) return;
        const { windowLength, lambdaReg, quantile } = req.body;
        const config = {
            windowLength: parseIntFinite(windowLength, CONFIG.windowLength),
            nFactors: CONFIG.nFactors,
            lambdaReg: parseFloatFinite(lambdaReg, CONFIG.lambdaReg),
            quantile: parseFloatFinite(quantile, CONFIG.quantile),
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

// ローカル data/ の状態（CLI 用）。Web シグナル自体は Yahoo ライブ取得。
app.get('/api/data-status', (req, res) => {
    try {
        res.json(getLocalDataStatus());
    } catch (e) {
        console.error('data-status:', e);
        res.status(500).json({ error: e.message });
    }
});

// 設定取得 API
app.get('/api/config', (req, res) => {
    res.json(CONFIG);
});

// 設定更新 API
app.post('/api/config', (req, res) => {
    if (process.env.ALLOW_CONFIG_MUTATION !== '1') {
        return res.status(403).json({
            error: '設定の書き換えは無効です。ローカルで有効にする場合は環境変数 ALLOW_CONFIG_MUTATION=1 を設定してください。',
        });
    }
    const allowed = ['windowLength', 'nFactors', 'lambdaReg', 'quantile', 'warmupPeriod'];
    for (const k of allowed) {
        if (req.body[k] === undefined) continue;
        if (k === 'nFactors' || k === 'windowLength' || k === 'warmupPeriod') {
            const x = parseInt(req.body[k], 10);
            if (Number.isFinite(x)) CONFIG[k] = x;
        } else {
            const x = parseFloat(req.body[k]);
            if (Number.isFinite(x)) CONFIG[k] = x;
        }
    }
    res.json(CONFIG);
});

app.listen(PORT, () => {
    console.log(`サーバー起動中: http://localhost:${PORT}`);
    console.log(`API エンドポイント:`);
    console.log(`  POST /api/backtest - バックテスト実行`);
    console.log(`  POST /api/signal - シグナル生成`);
    console.log(`  GET  /api/data-status - ローカル data/ の状態（CLI 用）`);
    console.log(`  GET  /api/config - 設定取得`);
    if (process.env.ALLOW_CONFIG_MUTATION === '1') {
        console.log(`  POST /api/config - 設定更新（ALLOW_CONFIG_MUTATION=1）`);
    } else {
        console.log(`  POST /api/config - 無効（書き換えには ALLOW_CONFIG_MUTATION=1 が必要）`);
    }
});
