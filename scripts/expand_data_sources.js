/**
 * TOPIX 業種別指数データ取得スクリプト
 * 日本取引所グループ（JPX）から長期データを取得
 * 
 * 注意：実際には JPX API または Yahoo! ファイナンスから取得
 * このスクリプトは Yahoo! ファイナンスから TOPIX 業種別 ETF を取得
 */

'use strict';

const fs = require('fs');
const path = require('path');

// TOPIX 業種別 ETF ティッカー（17 業種）
const TOPIX_SECTOR_ETF_TICKERS = [
  '1617.T', // 食品
  '1618.T', // 鉄鋼
  '1619.T', // 金属製品
  '1620.T', // 機械
  '1621.T', // 車・輸送機
  '1622.T', // 電気機器
  '1623.T', // 半導体等
  '1624.T', // 情報・通信
  '1625.T', // 運輸
  '1626.T', // 銀行
  '1627.T', // 保険
  '1628.T', // 証券・商品先物
  '1629.T', // 不動産
  '1630.T', // 小売
  '1631.T', // 電力・ガス
  '1632.T', // 化学
  '1633.T'  // 医薬品
];

const TOPIX_SECTOR_NAMES = [
  'Food',
  'Steel',
  'Metal_Products',
  'Machinery',
  'Automotive',
  'Electric_Equipment',
  'Semiconductors',
  'Telecom',
  'Transportation',
  'Banks',
  'Insurance',
  'Securities',
  'Real_Estate',
  'Retail',
  'Utilities',
  'Chemicals',
  'Pharmaceuticals'
];

console.log('='.repeat(80));
console.log('TOPIX 業種別指数 - データ拡充ツール');
console.log('='.repeat(80));

// Yahoo! ファイナンスからデータ取得（簡易版）
async function fetchFromYahoo(ticker, startDate = '2010-01-01', endDate = '2025-12-31') {
  console.log(`  ${ticker}...`);
  
  try {
    // yahoo-finance2 を使用
    const yahooFinance = require('yahoo-finance2').default;
    
    const result = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    });
    
    const data = result.quotes
      .filter(q => q.close !== null && q.close > 0)
      .map(q => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume
      }));
    
    return data;
  } catch (error) {
    console.error(`  ${ticker} Error: ${error.message}`);
    return [];
  }
}

// CSV 保存
function saveToCSV(data, filePath) {
  const header = 'date,open,high,low,close,volume\n';
  const lines = data.map(d => 
    `${d.date},${d.open},${d.high},${d.low},${d.close},${d.volume || 0}`
  );
  
  fs.writeFileSync(filePath, header + lines.join('\n'));
  console.log(`  保存完了：${filePath} (${data.length}行)`);
}

// メイン処理
async function main() {
  console.log('\nデータ取得開始...');
  console.log(`  対象ティッカー：${TOPIX_SECTOR_ETF_TICKERS.length}件`);
  console.log(`  期間：2010-01-01 〜 2025-12-31`);
  
  const outputDir = path.join(__dirname, '..', 'data', 'topix_sectors');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`  ディレクトリ作成：${outputDir}`);
  }
  
  const results = {};
  
  for (let i = 0; i < TOPIX_SECTOR_ETF_TICKERS.length; i++) {
    const ticker = TOPIX_SECTOR_ETF_TICKERS[i];
    const name = TOPIX_SECTOR_NAMES[i];
    
    const data = await fetchFromYahoo(ticker);
    
    if (data.length > 0) {
      results[ticker] = data;
      
      // CSV 保存
      const filePath = path.join(outputDir, `${ticker}.csv`);
      saveToCSV(data, filePath);
    }
    
    // レート制限回避
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // サマリー出力
  console.log('\n' + '='.repeat(80));
  console.log('データ取得サマリー');
  console.log('='.repeat(80));
  
  console.log('\nティッカー別データ行数:');
  console.log('ティッカー  業種名                      行数     開始日      終了日');
  console.log('-'.repeat(70));
  
  for (let i = 0; i < TOPIX_SECTOR_ETF_TICKERS.length; i++) {
    const ticker = TOPIX_SECTOR_ETF_TICKERS[i];
    const name = TOPIX_SECTOR_NAMES[i];
    const data = results[ticker] || [];
    
    if (data.length > 0) {
      console.log(
        `${ticker.padEnd(10)} ${name.padEnd(28)} ${String(data.length).padStart(6)}  ` +
        `${data[0].date.padEnd(10)}  ${data[data.length - 1].date.padEnd(10)}`
      );
    } else {
      console.log(`${ticker.padEnd(10)} ${name.padEnd(28)}      0  -           -`);
    }
  }
  
  // 結果保存
  const summaryPath = path.join(outputDir, 'data_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    tickers: TOPIX_SECTOR_ETF_TICKERS.map((t, i) => ({
      ticker: t,
      name: TOPIX_SECTOR_NAMES[i],
      rows: results[t]?.length || 0,
      startDate: results[t]?.[0]?.date || null,
      endDate: results[t]?.[results[t]?.length - 1]?.date || null
    })),
    totalRows: Object.values(results).reduce((sum, d) => sum + d.length, 0)
  }, null, 2));
  
  console.log(`\n💾 サマリーを保存しました：${summaryPath}`);
  
  // 既存の backtest/data との統合
  console.log('\n' + '='.repeat(80));
  console.log('データ統合');
  console.log('='.repeat(80));
  
  const backtestDataDir = path.join(__dirname, '..', 'backtest', 'data');
  let integratedCount = 0;
  
  for (const ticker of TOPIX_SECTOR_ETF_TICKERS) {
    const sourcePath = path.join(outputDir, `${ticker}.csv`);
    const targetPath = path.join(backtestDataDir, `${ticker}.csv`);
    
    if (fs.existsSync(sourcePath)) {
      const sourceData = fs.readFileSync(sourcePath, 'utf-8');
      
      // 既存データがある場合は比較
      if (fs.existsSync(targetPath)) {
        const targetData = fs.readFileSync(targetPath, 'utf-8');
        const sourceLines = sourceData.split('\n').filter(l => l.trim()).length;
        const targetLines = targetData.split('\n').filter(l => l.trim()).length;
        
        if (sourceLines > targetLines) {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`  ${ticker}: 更新 (${targetLines} → ${sourceLines}行)`);
          integratedCount++;
        } else {
          console.log(`  ${ticker}: スキップ（既存データが最新）`);
        }
      } else {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`  ${ticker}: 新規追加 (${sourceData.split('\n').filter(l => l.trim()).length}行)`);
        integratedCount++;
      }
    }
  }
  
  console.log(`\n  統合完了：${integratedCount}ティッカー`);
  
  console.log('\n' + '='.repeat(80));
  console.log('次のステップ');
  console.log('='.repeat(80));
  console.log('1. 統合データでバックテストを再実行');
  console.log('2. 長期パフォーマンスを検証');
  console.log('3. 為替・VIX・金利データの追加を検討');
}

main().catch(error => {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
});
