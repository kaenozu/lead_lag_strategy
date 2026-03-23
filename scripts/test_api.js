/**
 * API テストスクリプト
 */

const http = require('http');

function testApi(endpoint, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        console.log(`\n📡 リクエスト：${endpoint}`);
        console.log('ボディ:', JSON.stringify(body));

        const req = http.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    console.log(`✅ レスポンス (${res.statusCode}):`);
                    if (result.metrics) {
                        console.log('  AR:', result.metrics.AR.toFixed(2) + '%');
                        console.log('  RISK:', result.metrics.RISK.toFixed(2) + '%');
                        console.log('  RR:', result.metrics.RR.toFixed(2));
                        console.log('  MDD:', result.metrics.MDD.toFixed(2) + '%');
                        console.log('  Total:', result.metrics.Total.toFixed(2) + '%');
                        console.log('  Days:', result.metrics.Days);
                    } else if (result.error) {
                        console.log('  エラー:', result.error);
                    }
                    resolve(result);
                } catch (e) {
                    console.error('❌ パースエラー:', e.message);
                    console.error('レスポンス:', responseData.substring(0, 200));
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            console.error('❌ リクエストエラー:', e.message);
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log('='.repeat(50));
    console.log('API テスト開始');
    console.log('='.repeat(50));

    try {
        // テスト 1: 設定取得
        console.log('\n[テスト 1] 設定取得...');
        const configRes = await new Promise((resolve) => {
            http.get('http://localhost:3000/api/config', (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            });
        });
        console.log('✅ 設定:', configRes);

        // テスト 2: シグナル生成
        console.log('\n[テスト 2] シグナル生成...');
        await testApi('/api/signal', {
            windowLength: 30,
            lambdaReg: 0.9,
            quantile: 0.4
        });

        // テスト 3: バックテスト（短縮版）
        console.log('\n[テスト 3] バックテスト...');
        await testApi('/api/backtest', {
            windowLength: 30,
            lambdaReg: 0.9,
            quantile: 0.4
        });

        console.log('\n' + '='.repeat(50));
        console.log('✅ すべてのテスト完了！');
        console.log('='.repeat(50));

    } catch (e) {
        console.error('\n❌ テスト失敗:', e.message);
    }
}

runTests();
