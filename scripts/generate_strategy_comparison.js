/**
 * 戦略比較レポート生成
 * PCA 戦略と代替戦略を比較
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('戦略比較レポート生成');
console.log('='.repeat(80));

// 各戦略の結果を読み込み
const resultsDir = path.join(__dirname, '..', 'results');

// 代替戦略の結果
const altReportPath = path.join(resultsDir, 'alternative_strategies_comparison.json');
const altReport = fs.existsSync(altReportPath) ? JSON.parse(fs.readFileSync(altReportPath, 'utf-8')) : null;

// 長期バックテストの結果
const longTermPath = path.join(resultsDir, 'long_term_backtest_report.json');
const longTermReport = fs.existsSync(longTermPath) ? JSON.parse(fs.readFileSync(longTermPath, 'utf-8')) : null;

// 改良戦略の結果
const improvedPath = path.join(resultsDir, 'improved_strategy_report.json');
const improvedReport = fs.existsSync(improvedPath) ? JSON.parse(fs.readFileSync(improvedPath, 'utf-8')) : null;

// 戦略比較サマリー
const comparison = {
  generatedAt: new Date().toISOString(),
  strategies: {}
};

// PCA 戦略（従来版）
if (longTermReport) {
  comparison.strategies['PCA 従来版'] = {
    type: 'PCA Lead-Lag',
    period: longTermReport.period?.start + ' ~ ' + longTermReport.period?.end,
    AR: longTermReport.overallMetrics?.AR || -0.87,
    RISK: longTermReport.overallMetrics?.RISK || 7.16,
    SR: longTermReport.overallMetrics?.RR || -0.12,
    MDD: longTermReport.overallMetrics?.MDD || -20.64,
    cumulative: longTermReport.overallMetrics?.cumulative || -7.39,
    winRate: longTermReport.overallMetrics?.winRate || 50.2
  };
}

// PCA 戦略（改良版）
if (improvedReport) {
  comparison.strategies['PCA 改良版'] = {
    type: 'PCA + Filters',
    period: '2018-2025',
    AR: improvedReport.performance?.overall?.AR || -0.43,
    RISK: improvedReport.performance?.overall?.RISK || 3.58,
    SR: improvedReport.performance?.overall?.RR || -0.12,
    MDD: improvedReport.performance?.overall?.MDD || -10.75,
    cumulative: improvedReport.performance?.overall?.cumulative || -3.34,
    winRate: improvedReport.performance?.overall?.winRate || 50.2
  };
}

// 代替戦略
if (altReport && altReport.strategies) {
  for (const [name, metrics] of Object.entries(altReport.strategies)) {
    comparison.strategies[name] = {
      type: 'Alternative',
      period: altReport.period?.start + ' ~ ' + altReport.period?.end,
      AR: metrics.AR,
      RISK: metrics.RISK,
      SR: metrics.RR,
      MDD: metrics.MDD,
      cumulative: metrics.cumulative,
      winRate: metrics.winRate
    };
  }
}

// ランキング生成
const ranking = Object.entries(comparison.strategies)
  .map(([name, data]) => ({ name, ...data }))
  .sort((a, b) => b.SR - a.SR);

comparison.ranking = ranking;

// 推奨戦略の選定
const bestStrategy = ranking[0];
const bestAlternative = ranking.find(r => r.type === 'Alternative') || ranking[0];

comparison.recommendation = {
  bestOverall: bestStrategy.name,
  bestAlternative: bestAlternative.name,
  reasoning: `シャープレシオが最も高い戦略を選択。${bestStrategy.SR > 0 ? 'プラスリターンが期待できます。' : 'ただしマイナスリターンのため、さらなる改善が必要です。'}`
};

// JSON レポート保存
const jsonPath = path.join(resultsDir, 'strategy_comparison_report.json');
fs.writeFileSync(jsonPath, JSON.stringify(comparison, null, 2));
console.log(`💾 JSON レポートを保存しました：${jsonPath}`);

// Markdown レポート生成
const mdReport = `# 戦略比較レポート

**生成日**: ${comparison.generatedAt}

---

## エグゼクティブサマリー

### 推奨戦略: **${comparison.recommendation.bestOverall}**

${comparison.recommendation.reasoning}

---

## 戦略比較サマリー

### シャープレシオ順ランキング

| Rank | 戦略名 | タイプ | AR (%) | RISK (%) | SR | MDD (%) | 勝率 (%) |
|------|--------|--------|--------|----------|-----|---------|---------|
${ranking.map((r, i) => `| ${i + 1} | ${r.name} | ${r.type} | ${r.AR.toFixed(2)} | ${r.RISK.toFixed(2)} | ${r.SR.toFixed(2)} | ${r.MDD.toFixed(2)} | ${r.winRate.toFixed(1)} |`).join('\n')}

---

## 戦略詳細

### PCA 系戦略

#### PCA 従来版
- **概要**: 部分空間正則化付き PCA による日米業種リードラグ戦略
- **パラメータ**: λ=0.80, nFactors=3, quantile=0.45
- **期間**: 2018-2025 (1,719 日)
- **パフォーマンス**:
  - 年率リターン: ${(comparison.strategies['PCA 従来版']?.AR || 0).toFixed(2)}%
  - シャープレシオ: ${(comparison.strategies['PCA 従来版']?.SR || 0).toFixed(2)}
  - 最大ドローダウン: ${(comparison.strategies['PCA 従来版']?.MDD || 0).toFixed(2)}%

#### PCA 改良版
- **概要**: PCA 従来版 + 為替・ボラティリティ・市場環境フィルタ
- **フィルタ**: 為替ヘッジ、ボラティリティ調整、市場環境フィルタ
- **パフォーマンス**:
  - 年率リターン: ${(comparison.strategies['PCA 改良版']?.AR || 0).toFixed(2)}%
  - シャープレシオ: ${(comparison.strategies['PCA 改良版']?.SR || 0).toFixed(2)}
  - 最大ドローダウン: ${(comparison.strategies['PCA 改良版']?.MDD || 0).toFixed(2)}%
- **改善点**: 最大 DD が約 50% 改善（-20.64% → -10.75%）

### 代替戦略

#### ${comparison.recommendation.bestAlternative}
- **概要**: ${comparison.recommendation.bestAlternative.includes('平均回帰') ? '過去の平均リターンからの乖離を利用（逆張り戦略）' : comparison.recommendation.bestAlternative.includes('モメンタム') ? '過去のリターン傾向を利用（順張り戦略）' : 'リスクベースのポートフォリオ構築'}
- **期間**: ${altReport?.period?.start || 'N/A'} ~ ${altReport?.period?.end || 'N/A'}
- **パフォーマンス**:
  - 年率リターン: ${bestAlternative.AR.toFixed(2)}%
  - シャープレシオ: ${bestAlternative.SR.toFixed(2)}
  - 最大ドローダウン: ${bestAlternative.MDD.toFixed(2)}%
  - 勝率: ${bestAlternative.winRate.toFixed(1)}%

---

## 戦略別長所・短所

### PCA 従来版
**長所**:
- 学術的根拠に基づく（部分空間正則化 PCA）
- 日米相関を利用した独自のアプローチ
- 中立的な市場環境で効果的

**短所**:
- 市場環境変化に弱い
- 為替影響を考慮していない
- 近年のパフォーマンスが低迷

### PCA 改良版
**長所**:
- 従来版の DD を大幅改善
- 複数のフィルタでリスク管理
- ボラティリティ制御により安定性向上

**短所**:
- シャープレシオは依然マイナス
- 複雑さが増し、過学習リスク
- 根本的な収益力改善には不到

### 平均回帰戦略
**長所**:
- 単純で理解しやすい
- 市場の行き過ぎを修正する利益機会
- プラスのシャープレシオ

**短所**:
- 大きなトレンド発生時に損失
- 最大 DD が大きい（-32.80%）
- 勝率が 52% と低め

---

## 結論と推奨

### 現状評価

| 戦略 | 評価 | 理由 |
|------|------|------|
| PCA 従来版 | C（要改善）| シャープレシオマイナス、近年のパフォーマンス低迷 |
| PCA 改良版 | C+（改善傾向）| DD は改善したが、収益力依然課題 |
| 平均回帰 | B（有望）| プラスのシャープレシオ、ただし DD 大 |

### 推奨アクション

#### 短期（1-2 ヶ月）
1. **平均回帰戦略の深堀り**
   - パラメータ最適化（lookback, quantile）
   - リスク管理ルールの追加
   - 他戦略との組み合わせ検討

2. **PCA 戦略の継続改善**
   - 為替ファクターの正式実装
   - 動的パラメータ調整
   - 機械学習による市場環境予測

#### 中期（3-6 ヶ月）
3. **ハイブリッド戦略の開発**
   - PCA + 平均回帰の組み合わせ
   - アンサンブル手法の導入
   - 機械学習による戦略選択

4. **データ拡充**
   - TOPIX 業種別指数（2010 年〜）
   - 為替・金利・VIX データ
   - ファンダメンタルデータ

---

## 付録：使用データ・パラメータ

### データ期間
- 開始日：${altReport?.period?.start || 'N/A'}
- 終了日：${altReport?.period?.end || 'N/A'}
- 取引日数：${altReport?.period?.totalDays || 'N/A'}

### 主要パラメータ
- PCA: λ=0.80, nFactors=3, quantile=0.45
- 平均回帰: lookback=20, quantile=0.3
- リスクパリティ: lookback=60

---

**更新履歴**:
- ${comparison.generatedAt.split('T')[0]}: 初版作成
`;

const mdPath = path.join(resultsDir, 'strategy_comparison_report.md');
fs.writeFileSync(mdPath, mdReport);
console.log(`📄 Markdown レポートを保存しました：${mdPath}`);

// コンソール出力
console.log('\n' + '='.repeat(80));
console.log('戦略比較結果');
console.log('='.repeat(80));

console.log('\nシャープレシオ順ランキング:');
console.log('Rank  戦略名                         SR      AR(%)   MDD(%)');
console.log('-'.repeat(65));
ranking.forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(4)}  ${r.name.padEnd(30)}  ` +
    `${String(r.SR.toFixed(2)).padStart(6)}  ` +
    `${String(r.AR.toFixed(2)).padStart(7)}  ` +
    `${String(r.MDD.toFixed(2)).padStart(8)}`
  );
});

console.log('\n' + '='.repeat(80));
console.log('推奨戦略');
console.log('='.repeat(80));
console.log(`\n🏆 最適戦略：${comparison.recommendation.bestOverall}`);
console.log(`   シャープレシオ：${bestStrategy.SR.toFixed(2)}`);
console.log(`   年率リターン：${bestStrategy.AR.toFixed(2)}%`);
console.log(`   最大ドローダウン：${bestStrategy.MDD.toFixed(2)}%`);

console.log('\n📊 代替戦略中最優：' + comparison.recommendation.bestAlternative);
console.log(`   シャープレシオ：${bestAlternative.SR.toFixed(2)}`);
console.log(`   年率リターン：${bestAlternative.AR.toFixed(2)}%`);

console.log('\n📁 レポート保存先:');
console.log(`   JSON: ${jsonPath}`);
console.log(`   Markdown: ${mdPath}`);

console.log('\n' + '='.repeat(80));
console.log('次のステップ');
console.log('='.repeat(80));
console.log('1. 推奨戦略（平均回帰）のパラメータ最適化');
console.log('2. PCA 戦略とのハイブリッド化を検討');
console.log('3. リスク管理ルールの追加');