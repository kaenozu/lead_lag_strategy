/**
 * バックテスト動作確認スクリプト
 */

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T', '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T', '1631.T', '1632.T', '1633.T'];

async function fetchData(ticker, days = 200) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        console.log(`  ${ticker} のデータ取得中...`);
        const result = await yahooFinance.chart(ticker, {
            period1: startDate.toISOString().split('T')[0],
            period2: endDate.toISOString().split('T')[0],
            interval: '1d'
        });

        const data = result.quotes
            .filter(q => q.close !== null && q.close > 0)
            .map(q => ({
                date: q.date.toISOString().split('T')[0],
                open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
            }));

        console.log(`  ${ticker}: ${data.length} 日`);
        return data;
    } catch (e) {
        console.error(`  ${ticker} Error: ${e.message}`);
        return [];
    }
}

async function testBacktest() {
    console.log('='.repeat(50));
    console.log('バックテスト動作確認テスト');
    console.log('='.repeat(50));

    console.log('\n[1/3] 米国 ETF データ取得テスト...');
    const usData = {};
    for (const ticker of US_ETF_TICKERS.slice(0, 2)) { // 最初の 2 つだけ
        usData[ticker] = await fetchData(ticker, 100);
    }

    console.log('\n[2/3] 日本 ETF データ取得テスト...');
    const jpData = {};
    for (const ticker of JP_ETF_TICKERS.slice(0, 2)) { // 最初の 2 つだけ
        jpData[ticker] = await fetchData(ticker, 100);
    }

    console.log('\n[3/3] データ確認...');
    console.log('米国データ:', Object.keys(usData).map(k => `${k}=${usData[k].length}日`).join(', '));
    console.log('日本データ:', Object.keys(jpData).map(k => `${k}=${jpData[k].length}日`).join(', '));

    // リターン計算テスト
    function computeReturns(ohlc) {
        const ret = [];
        let prev = null;
        for (const r of ohlc) {
            if (prev !== null) ret.push((r.close - prev) / prev);
            prev = r.close;
        }
        return ret;
    }

    const testRet = computeReturns(usData['XLB']);
    console.log(`\nリターン計算テスト：${testRet.length} 日 (有効データ)`);

    console.log('\n' + '='.repeat(50));
    console.log('✅ テスト完了！');
    console.log('='.repeat(50));
}

testBacktest().catch(e => {
    console.error('❌ エラー:', e.message);
    console.error(e.stack);
});
