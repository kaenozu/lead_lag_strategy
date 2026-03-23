/**
 * ペーパートレードツール - リスクなしで戦略を検証
 * 
 * 仮想取引でパフォーマンスを追跡
 */

const fs = require('fs');
const path = require('path');

// 設定
const INITIAL_CAPITAL = 1000000;  // 初期資金 100 万円
const COMMISSION_RATE = 0.0003;    // 手数料 0.03%
const SLIPPAGE_RATE = 0.0005;      // スリッページ 0.05%

class PaperTrader {
  constructor(initialCapital = INITIAL_CAPITAL) {
    this.capital = initialCapital;
    this.initialCapital = initialCapital;
    this.positions = [];
    this.trades = [];
    this.dailyReturns = [];
    this.equityCurve = [{ date: null, equity: initialCapital }];
  }

  // 買い注文
  buy(ticker, price, amount, date) {
    const shares = Math.floor(amount / price / 100) * 100;
    if (shares <= 0) return null;
        
    const cost = shares * price;
    const commission = cost * COMMISSION_RATE;
    const slippage = cost * SLIPPAGE_RATE;
    const totalCost = cost + commission + slippage;

    if (totalCost > this.capital) return null;

    this.capital -= totalCost;
    const position = {
      type: 'long',
      ticker,
      shares,
      entryPrice: price,
      entryDate: date,
      cost: totalCost
    };
    this.positions.push(position);
    this.trades.push({
      date, type: 'BUY', ticker, shares, price,
      cost: totalCost, commission, slippage
    });
    return position;
  }

  // 売り注文（空売り）
  sell(ticker, price, amount, date) {
    const shares = Math.floor(amount / price / 100) * 100;
    if (shares <= 0) return null;
        
    const proceeds = shares * price;
    const commission = proceeds * COMMISSION_RATE;
    const slippage = proceeds * SLIPPAGE_RATE;
    const margin = proceeds * 0.3;  // 委託保証金 30%

    if (margin > this.capital) return null;

    this.capital -= margin;
    const position = {
      type: 'short',
      ticker,
      shares,
      entryPrice: price,
      entryDate: date,
      margin,
      proceeds
    };
    this.positions.push(position);
    this.trades.push({
      date, type: 'SELL', ticker, shares, price,
      proceeds, commission, slippage, margin
    });
    return position;
  }

  // ポジション決済
  closePosition(position, exitPrice, date) {
    const index = this.positions.indexOf(position);
    if (index === -1) return 0;

    let pnl = 0;
    let commission = 0;
    let slippage = 0;

    if (position.type === 'long') {
      const proceeds = position.shares * exitPrice;
      commission = proceeds * COMMISSION_RATE;
      slippage = proceeds * SLIPPAGE_RATE;
      pnl = proceeds - position.cost - commission - slippage;
      this.capital += proceeds - commission - slippage;
    } else {
      const costToCover = position.shares * exitPrice;
      commission = costToCover * COMMISSION_RATE;
      slippage = costToCover * SLIPPAGE_RATE;
      pnl = position.proceeds - costToCover - commission - slippage;
      this.capital += position.margin + pnl;
    }

    this.positions.splice(index, 1);
    this.trades.push({
      date, type: 'CLOSE', ticker: position.ticker,
      exitPrice, pnl, commission, slippage
    });

    return pnl;
  }

  // 一日の終了処理
  endOfDay(date, prices) {
    // ポジション評価
    let totalEquity = this.capital;
    for (const pos of this.positions) {
      const price = prices[pos.ticker] || pos.entryPrice;
      if (pos.type === 'long') {
        totalEquity += pos.shares * price;
      } else {
        const unrealizedPnl = pos.proceeds - pos.shares * price;
        totalEquity += unrealizedPnl;
      }
    }

    // 前日比計算
    const prevEquity = this.equityCurve.length > 0 ? 
      this.equityCurve[this.equityCurve.length - 1].equity : this.initialCapital;
    const dailyReturn = (totalEquity - prevEquity) / prevEquity;
    this.dailyReturns.push({ date, return: dailyReturn });

    this.equityCurve.push({ date, equity: totalEquity });
    return totalEquity;
  }

  // パフォーマンス指標
  getMetrics() {
    if (this.dailyReturns.length === 0) {
      return {
        totalReturn: 0,
        totalReturnPct: 0,
        sharpe: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0
      };
    }

    const returns = this.dailyReturns.map(r => r.return);
    const totalReturn = this.equityCurve[this.equityCurve.length - 1].equity - this.initialCapital;
    const totalReturnPct = (totalReturn / this.initialCapital) * 100;
        
    // シャープレシオ
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / returns.length);
    const sharpe = stdReturn > 0 ? (avgReturn * 252) / (stdReturn * Math.sqrt(252)) : 0;

    // 最大ドローダウン
    let maxEq = this.initialCapital;
    let maxDrawdown = 0;
    for (const point of this.equityCurve) {
      if (point.equity > maxEq) maxEq = point.equity;
      const dd = (point.equity - maxEq) / maxEq;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    // 勝率・プロフィットファクター
    const closedTrades = this.trades.filter(t => t.type === 'CLOSE');
    const wins = closedTrades.filter(t => t.pnl > 0);
    const losses = closedTrades.filter(t => t.pnl <= 0);
    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
        
    const totalWins = wins.reduce((a, t) => a + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    return {
      totalReturn,
      totalReturnPct,
      sharpe,
      maxDrawdown: maxDrawdown * 100,
      winRate: winRate * 100,
      profitFactor,
      totalTrades: closedTrades.length,
      winningTrades: wins.length,
      losingTrades: losses.length
    };
  }

  // 結果保存
  saveResults(outputDir) {
    const metrics = this.getMetrics();
        
    // メトリクス保存
    const metricsJson = JSON.stringify(metrics, null, 2);
    fs.writeFileSync(path.join(outputDir, 'paper_trading_metrics.json'), metricsJson);

    // エクイティカーブ保存
    const equityCsv = 'Date,Equity\n' + 
            this.equityCurve.map(p => `${p.date || 'Initial'},${p.equity.toFixed(2)}`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'paper_trading_equity.csv'), equityCsv);

    // 取引履歴保存
    const tradesCsv = 'Date,Type,Ticker,Shares,Price,PnL,Commission,Slippage\n' +
            this.trades.map(t => 
              `${t.date},${t.type},${t.ticker},${t.shares || ''},${t.price || t.exitPrice},${t.pnl || ''},${t.commission || ''},${t.slippage || ''}`
            ).join('\n');
    fs.writeFileSync(path.join(outputDir, 'paper_trading_trades.csv'), tradesCsv);

    return metrics;
  }
}

// デモ実行
async function main() {
  console.log('='.repeat(70));
  console.log('📝 ペーパートレードツール');
  console.log('='.repeat(70));

  const outputDir = path.join(__dirname, 'results');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // トレーダー作成
  const trader = new PaperTrader(1000000);
  console.log('\n初期資金：1,000,000 円');

  // 模擬取引（例）
  console.log('\n模擬取引を実行中...');
    
  // 例：買い注文
  trader.buy('1618.T', 1500, 100000, '2025-01-15');
  trader.buy('1631.T', 1200, 100000, '2025-01-15');
    
  // 例：売り注文
  trader.sell('1621.T', 1800, 100000, '2025-01-15');
    
  // 例：決済
  const longPos = trader.positions.find(p => p.ticker === '1618.T');
  if (longPos) {
    trader.closePosition(longPos, 1520, '2025-01-16');  // +20 円
  }
    
  // 一日の終了処理
  const prices = { '1631.T': 1210, '1621.T': 1790 };
  trader.endOfDay('2025-01-16', prices);

  // 結果保存
  const metrics = trader.saveResults(outputDir);

  console.log('\n' + '='.repeat(70));
  console.log('パフォーマンス結果');
  console.log('='.repeat(70));
  console.log(`総リターン：${metrics.totalReturnPct.toFixed(2)}% (${metrics.totalReturn.toFixed(0)}円)`);
  console.log(`シャープレシオ：${metrics.sharpe.toFixed(2)}`);
  console.log(`最大ドローダウン：${metrics.maxDrawdown.toFixed(2)}%`);
  console.log(`勝率：${metrics.winRate.toFixed(1)}%`);
  console.log(`プロフィットファクター：${metrics.profitFactor.toFixed(2)}`);
  console.log(`総取引数：${metrics.totalTrades}回（勝ち：${metrics.winningTrades}回、負け：${metrics.losingTrades}回）`);

  console.log('\n' + '='.repeat(70));
  console.log('結果を保存しました:');
  console.log('  - results/paper_trading_metrics.json');
  console.log('  - results/paper_trading_equity.csv');
  console.log('  - results/paper_trading_trades.csv');
  console.log('='.repeat(70));

  console.log('\n💡 使い方:');
  console.log('1. npm run signal でシグナルを生成（または Web UI）');
  console.log('2. npm run paper でこのデモを実行（独自に PaperTrader を組み込む場合は本ファイルを参照）');
  console.log('3. 本番運用では毎日 endOfDay() で評価する想定');
  console.log('4. 月末に getMetrics() でパフォーマンス確認');
}

// エクスポート
module.exports = { PaperTrader };

// 実行
if (require.main === module) {
  main().catch(console.error);
}
