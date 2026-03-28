/**
 * 戦略探索デバッグ
 * データと計算プロセスを検証
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { computePerformanceMetrics } = require('../lib/portfolio');

console.log('データ検証...');

const dataDir = path.join(__dirname, '..', 'backtest', 'data');
const ticker = '1617.T';
const filePath = path.join(dataDir, `${ticker}.csv`);

const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n').slice(1).filter(l => l.trim());

console.log(`\n${ticker} のデータ:`);
console.log(`  行数：${lines.length}`);
console.log('  最初の 5 行:');

for (let i = 0; i < 5; i++) {
  const [date, open, , , close] = lines[i].split(',');
  console.log(`    ${date}: O=${open}, C=${close}`);
}

console.log('\n  最後の 5 行:');
for (let i = lines.length - 5; i < lines.length; i++) {
  const [date, open, , , close] = lines[i].split(',');
  console.log(`    ${date}: O=${open}, C=${close}`);
}

// リターン計算
console.log('\nリターン計算の検証:');
const prices = lines.map(line => {
  const parts = line.split(',');
  return {
    date: parts[0],
    close: parseFloat(parts[4])
  };
});

const returns = [];
for (let i = 1; i < prices.length; i++) {
  const ret = (prices[i].close - prices[i-1].close) / prices[i-1].close;
  returns.push(ret);
}

console.log(`  リターン数：${returns.length}`);
console.log(`  リターンの範囲：[${Math.min(...returns).toFixed(6)}, ${Math.max(...returns).toFixed(6)}]`);
console.log(`  平均リターン：${(returns.reduce((a,b) => a+b, 0) / returns.length * 100).toFixed(4)}%`);

// パフォーマンス計算
const metrics = computePerformanceMetrics(returns, 252);
console.log('\n  パフォーマンス:');
console.log(`    年率リターン：${(metrics.AR * 100).toFixed(2)}%`);
console.log(`    年率リスク：${(metrics.RISK * 100).toFixed(2)}%`);
console.log(`    シャープレシオ：${(metrics.RR || 0).toFixed(2)}`);
console.log(`    最大 DD: ${(metrics.MDD * 100).toFixed(2)}%`);

// 単純モメンタム戦略のテスト
console.log('\n単純モメンタム戦略のテスト（1 銘柄のみ）:');
const momentumWindow = 20;
const momentumReturns = [];

for (let i = momentumWindow; i < returns.length; i++) {
  // 過去 20 日のリターン合計
  const momentum = returns.slice(i - momentumWindow, i).reduce((a, b) => a + b, 0);
  
  // シグナル：positive momentum = long
  const signal = momentum > 0 ? 1 : -1;
  
  // 翌日リターン
  const nextReturn = returns[i];
  
  // 戦略リターン
  const stratReturn = signal * nextReturn;
  momentumReturns.push(stratReturn);
}

const momMetrics = computePerformanceMetrics(momentumReturns, 252);
console.log(`  戦略リターン数：${momentumReturns.length}`);
console.log(`  平均戦略リターン：${(momentumReturns.reduce((a,b) => a+b, 0) / momentumReturns.length * 100).toFixed(4)}%`);
console.log(`  勝率：${(momentumReturns.filter(r => r > 0).length / momentumReturns.length * 100).toFixed(1)}%`);
console.log(`    年率リターン：${(momMetrics.AR * 100).toFixed(2)}%`);
console.log(`    シャープレシオ：${(momMetrics.RR || 0).toFixed(2)}`);
