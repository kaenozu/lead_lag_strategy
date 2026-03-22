/**
 * 環境・データの事前チェック（初心者向け）
 * npm run doctor
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { US_ETF_TICKERS, JP_ETF_TICKERS } = require('./sector_constants');

const root = __dirname;
const dataDir = path.join(root, 'data');
const resultsDir = path.join(root, 'results');

const MIN_NODE_MAJOR = 18;

function ok(msg) {
    console.log(`  OK  ${msg}`);
}

function warn(msg) {
    console.log(`  WARN  ${msg}`);
}

function bad(msg) {
    console.log(`  NG  ${msg}`);
}

let hasNg = false;

function isLightMode() {
    if (process.argv.includes('--light')) return true;
    if (process.env.DOCTOR_LIGHT === '1') return true;
    return false;
}

function main() {
    const light = isLightMode();

    console.log('='.repeat(60));
    console.log('lead_lag_strategy — 環境チェック (npm run doctor)');
    if (light) {
        console.log('モード: 軽量（Node / results のみ・data/ はスキップ。CI 用は npm run doctor:ci）');
    }
    console.log('='.repeat(60));

    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major >= MIN_NODE_MAJOR) {
        ok(`Node.js ${process.version}（推奨: v${MIN_NODE_MAJOR} 以上）`);
    } else {
        bad(`Node.js ${process.version} — v${MIN_NODE_MAJOR} 以上への更新を推奨します`);
        hasNg = true;
    }

    if (light) {
        ok('data/ の CSV チェックはスキップしました（フルチェックは npm run doctor）');
    } else {
        if (!fs.existsSync(dataDir)) {
            bad(`フォルダ data/ がありません`);
            hasNg = true;
        } else {
            ok('フォルダ data/ があります');
        }

        const need = [...US_ETF_TICKERS, ...JP_ETF_TICKERS];
        const missing = [];
        const empty = [];

        for (const t of need) {
            const f = path.join(dataDir, `${t}.csv`);
            if (!fs.existsSync(f)) {
                missing.push(t);
                continue;
            }
            const raw = fs.readFileSync(f, 'utf-8');
            const lines = raw.split('\n').filter(l => l.trim());
            if (lines.length <= 1) {
                empty.push(t);
            }
        }

        if (missing.length === 0 && empty.length === 0) {
            ok(`米国 ${US_ETF_TICKERS.length} + 日本 ${JP_ETF_TICKERS.length} 銘柄の CSV が揃っています`);
        } else {
            if (missing.length) {
                bad(`CSV が無い銘柄（${missing.length}）: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
                hasNg = true;
            }
            if (empty.length) {
                bad(`中身がほぼ空の CSV: ${empty.slice(0, 8).join(', ')}${empty.length > 8 ? ' …' : ''}`);
                hasNg = true;
            }
        }
    }

    try {
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        const probe = path.join(resultsDir, '.doctor_write_test');
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        ok('results/ に書き込みできます');
    } catch (e) {
        bad(`results/ に書けません: ${e.message}`);
        hasNg = true;
    }

    console.log('='.repeat(60));
    if (!hasNg) {
        console.log('問題なさそうです。次は npm run signal や npm run server を試せます。');
        if (light) {
            console.log('（本番前のデータ確認は引き続き npm run doctor をフルで実行してください。）');
        } else {
            console.log('（初回はデータが無い場合、先に npm run setup を実行してください。）');
        }
    } else {
        console.log('上記 NG を解消してください。多くの場合、次で改善します:');
        console.log('');
        console.log('  npm install');
        console.log('  npm run setup     # Yahoo から data/*.csv を取得（数分かかります）');
        console.log('  npm run doctor    # 再チェック');
        process.exitCode = 1;
    }
    console.log('='.repeat(60));
}

main();
