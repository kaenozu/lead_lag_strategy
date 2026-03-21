/**
 * シグナル生成ツール - 初心者向け
 *
 * 毎日の売買指示を具体的な金額とともに出力
 */

const fs = require('fs');
const path = require('path');
const { correlationMatrix, LeadLagSignal } = require('./lib/lead_lag_core');
const { buildLeadLagMatrices } = require('./lib/lead_lag_matrices');
const { US_ETF_TICKERS, JP_ETF_TICKERS, JP_ETF_NAMES, SECTOR_LABELS } = require('./sector_constants');

// 設定
const CONFIG = {
    windowLength: 40,
    nFactors: 3,
    lambdaReg: 0.95,
    quantile: 0.3,
    warmupPeriod: 40,
};

function loadLocalData(dataDir, tickers) {
    const results = {};
    for (const t of tickers) {
        const f = path.join(dataDir, `${t}.csv`);
        if (fs.existsSync(f)) {
            const lines = fs.readFileSync(f, 'utf-8').split('\n').slice(1).filter(l => l.trim());
            results[t] = lines.map(l => {
                const p = l.split(',');
                return { date: p[0], open: +p[1], close: +p[4] };
            });
        } else results[t] = [];
    }
    return results;
}

function computeCFull(retUs, retJp) {
    return correlationMatrix(retUs.map((r, i) => [...r.values, ...retJp[i].values]));
}

function generateSignal(retUs, retJp, retJpOc, config, sectorLabels, CFull) {
    const nJp = JP_ETF_TICKERS.length;
    const signalGen = new LeadLagSignal(config);
    const i = retJpOc.length - 1;
    const usWin = retUs.slice(i - config.windowLength, i).map(r => r.values);
    const jpWin = retJp.slice(i - config.windowLength, i).map(r => r.values);
    const usLatest = retUs[i - 1].values;
    const signal = signalGen.compute(usWin, jpWin, usLatest, sectorLabels, CFull);
    const indexed = signal.map((val, idx) => ({ val, idx, ticker: JP_ETF_TICKERS[idx] })).sort((a, b) => a.val - b.val);
    const q = Math.max(1, Math.floor(nJp * config.quantile));
    return {
        long: indexed.slice(-q).map(s => ({ ticker: s.ticker, sector: JP_ETF_NAMES[s.ticker], signal: s.val })),
        short: indexed.slice(0, q).map(s => ({ ticker: s.ticker, sector: JP_ETF_NAMES[s.ticker], signal: s.val })),
        all: indexed.map(s => ({ ticker: s.ticker, sector: JP_ETF_NAMES[s.ticker], signal: s.val })),
    };
}

function calculateInvestment(longSignals, shortSignals, totalCapital = 1000000) {
    const perPosition = Math.floor(totalCapital / (longSignals.length + shortSignals.length) / 100) * 100;
    return {
        long: longSignals.map(s => ({ ...s, amount: perPosition })),
        short: shortSignals.map(s => ({ ...s, amount: perPosition })),
        totalLong: perPosition * longSignals.length,
        totalShort: perPosition * shortSignals.length,
        remaining: totalCapital - (perPosition * (longSignals.length + shortSignals.length)),
    };
}

async function main() {
    console.log('='.repeat(70));
    console.log('📈 日米業種リードラグ戦略 - シグナル生成ツール');
    console.log('='.repeat(70));

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'results');

    console.log('\n[1/3] データ読み込み中...');
    const usData = loadLocalData(dataDir, US_ETF_TICKERS);
    const jpData = loadLocalData(dataDir, JP_ETF_TICKERS);

    console.log('[2/3] データ処理中...');
    const { retUs, retJp, retJpOc, dates } = buildLeadLagMatrices(usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS);
    const CFull = computeCFull(retUs, retJp);
    console.log(`  最終取引日：${dates[dates.length - 1]}`);

    console.log('[3/3] シグナル生成中...\n');
    const signal = generateSignal(retUs, retJp, retJpOc, CONFIG, SECTOR_LABELS, CFull);
    const investment = calculateInvestment(signal.long, signal.short, 1000000);

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
    console.log('='.repeat(70));
    console.log(`📅 本日のシグナル（${today}）`);
    console.log('='.repeat(70));

    console.log('\n💰 推奨投資額（総額 100 万円の場合）');
    console.log('-'.repeat(70));
    console.log(`買い合計：${investment.totalLong.toLocaleString()}円`);
    console.log(`売り合計：${investment.totalShort.toLocaleString()}円`);
    console.log(`余力：${investment.remaining.toLocaleString()}円`);

    console.log('\n📊 買い銘柄（ロング）');
    console.log('-'.repeat(70));
    console.log('ランク  ティッカー  業種           投資額      シグナル値');
    investment.long.forEach((s, i) => {
        console.log(`  ${i + 1}      ${s.ticker.padEnd(8)}  ${s.sector.padEnd(10)}  ${s.amount.toLocaleString()}円  ${s.signal.toFixed(2)}`);
    });

    console.log('\n📉 売り銘柄（ショート）');
    console.log('-'.repeat(70));
    console.log('ランク  ティッカー  業種           投資額      シグナル値');
    investment.short.forEach((s, i) => {
        console.log(`  ${i + 1}      ${s.ticker.padEnd(8)}  ${s.sector.padEnd(10)}  ${s.amount.toLocaleString()}円  ${s.signal.toFixed(2)}`);
    });

    console.log('\n' + '='.repeat(70));
    console.log('📝 取引の注意点');
    console.log('='.repeat(70));
    console.log('1. 買い銘柄は「買って上昇を待つ」、売り銘柄は「空売りして下落を待つ」');
    console.log('2. 各銘柄の投資額は均等配分（リスク分散）');
    console.log('3. 朝 9:00 の寄り付き前に注文を出すのが理想');
    console.log('4. 夕方の大引けで決済する（デイトレード）');
    console.log('5. 週末はポジションを持たないのが安全');

    console.log('\n' + '='.repeat(70));
    console.log('⚠️ リスク警告');
    console.log('='.repeat(70));
    console.log('・元本割れの可能性があります');
    console.log('・過去のパフォーマンスは将来を保証しません');
    console.log('・余力を残して無理な取引はしないでください');
    console.log('・このシグナルは投資助言ではありません');

    const signalJson = {
        date: dates[dates.length - 1],
        generatedAt: new Date().toISOString(),
        parameters: CONFIG,
        signals: {
            long: investment.long,
            short: investment.short,
        },
        investment: {
            totalLong: investment.totalLong,
            totalShort: investment.totalShort,
            remaining: investment.remaining,
            totalCapital: 1000000,
        },
    };
    fs.writeFileSync(path.join(outputDir, 'signal.json'), JSON.stringify(signalJson, null, 2));

    const longCsv = 'Rank,Ticker,Sector,Amount,Signal\n' + investment.long.map((s, i) => `${i + 1},${s.ticker},${s.sector},${s.amount},${s.signal.toFixed(4)}`).join('\n');
    const shortCsv = 'Rank,Ticker,Sector,Amount,Signal\n' + investment.short.map((s, i) => `${i + 1},${s.ticker},${s.sector},${s.amount},${s.signal.toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'signal_long.csv'), longCsv);
    fs.writeFileSync(path.join(outputDir, 'signal_short.csv'), shortCsv);

    console.log(`\n💾 保存完了：results/signal.json, signal_long.csv, signal_short.csv`);
    console.log('='.repeat(70));
}

main().catch(console.error);
