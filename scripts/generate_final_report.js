/**
 * 戦略最適化 - 最終レポート生成
 * 全ての分析結果を統合した総合レポートを作成
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, '..', 'results');

// レポートテンプレート
function generateReport() {
  const now = new Date().toISOString();
  
  const report = {
    title: '日米業種リードラグ戦略 - 最適化完了レポート',
    generatedAt: now,
    executiveSummary: {
      conclusion: 'C（要改善）',
      keyFindings: [
        '実装に重大な問題は検出されず（ルックアヘッドバイアスなし）',
        '長期バックテスト（2018-2025）で年率 -0.87%、シャープレシオ -0.12',
        '戦略改良により最大 DD を改善（-20.64% → -10.75%）',
        '為替・ボラティリティ・市場環境フィルタは有効だが、根本的解決に至らず'
      ],
      recommendation: '戦略の根本的見直しを推奨（マルチファクター・機械学習の導入）'
    },
    phase1_verification: {
      title: 'Phase 1: 実装検証',
      status: '✅ 完了',
      findings: {
        parameters: {
          windowLength: 60,
          nFactors: 3,
          lambdaReg: 0.80,
          quantile: 0.45
        },
        lookaheadBias: '検出されず（相関検出率 51.0%）',
        transactionCosts: '論文と一致（0%）',
        signalCalculation: '正常（ロングショート中立）'
      },
      simpleBacktest: {
        period: 'サンプル 100 日',
        AR: '3.39%',
        risk: '5.08%',
        sharpe: '0.67',
        mdd: '-3.64%',
        winRate: '49.0%'
      }
    },
    phase2_longTermBacktest: {
      title: 'Phase 2: 長期バックテスト',
      status: '✅ 完了',
      period: '2018-09-14 ~ 2025-12-30 (1,719 日)',
      overallPerformance: {
        AR: '-0.87%',
        risk: '7.16%',
        sharpe: '-0.12',
        mdd: '-20.64%',
        cumulative: '-7.39%',
        winRate: '50.2%'
      },
      yearlyPerformance: [
        { year: '2018', AR: '3.18%', sharpe: '0.61', mdd: '-3.92%' },
        { year: '2019', AR: '0.74%', sharpe: '0.16', mdd: '-4.22%' },
        { year: '2020', AR: '9.99%', sharpe: '1.08', mdd: '-7.23%' },
        { year: '2021', AR: '-11.21%', sharpe: '-1.71', mdd: '-10.81%' },
        { year: '2022', AR: '-5.16%', sharpe: '-0.67', mdd: '-12.52%' },
        { year: '2023', AR: '-2.65%', sharpe: '-0.41', mdd: '-3.86%' },
        { year: '2024', AR: '1.31%', sharpe: '0.18', mdd: '-4.77%' },
        { year: '2025', AR: '-0.19%', sharpe: '-0.02', mdd: '-8.04%' }
      ],
      keyInsights: [
        '2020 年のみプラスリターン（コロナ禍の特殊環境）',
        '2021-2022 年は大幅マイナス（米国利上げ局面）',
        '年別パフォーマンスのばらつきが大きい'
      ]
    },
    phase3_improvedStrategy: {
      title: 'Phase 3: 戦略改良',
      status: '✅ 完了',
      filters: {
        fxHedge: { enabled: true, threshold: '2%', effect: '円安でポジション削減' },
        volatilityAdjustment: { enabled: true, targetVol: '10%', effect: '高ボラティリティで削減' },
        marketFilter: { enabled: true, bull: 1.05, bear: 0.95, effect: '弱気相場で取引停止' }
      },
      performance: {
        AR: '-0.43%',
        risk: '3.58%',
        sharpe: '-0.12',
        mdd: '-10.75%',
        cumulative: '-3.34%'
      },
      comparison: {
        baseline: { AR: '-0.87%', sharpe: '-0.12', mdd: '-20.64%' },
        improved: { AR: '-0.43%', sharpe: '-0.12', mdd: '-10.75%' },
        improvement: { AR: '+0.44%', sharpe: '±0', mdd: '+9.89%' }
      },
      keyInsights: [
        '最大ドローダウンが約半分に改善',
        'ボラティリティも大幅低下（7.16% → 3.58%）',
        'しかしシャープレシオは依然マイナス'
      ]
    },
    phase4_finalEvaluation: {
      title: 'Phase 4: 総合評価',
      scores: {
        profitability: { score: 2, max: 5, reason: '全期間でマイナスリターン' },
        stability: { score: 2, max: 5, reason: '年別パフォーマンスが不安定' },
        riskManagement: { score: 3, max: 5, reason: 'フィルタは有効だが根本的解決に不到' },
        academicValidity: { score: 4, max: 5, reason: '部分空間正則化 PCA の理論は堅固' },
        practicality: { score: 2, max: 5, reason: '現状では実運用に耐えない' }
      },
      totalScore: { score: 13, max: 25, percentage: '52%' }
    },
    rootCauseAnalysis: {
      title: '根本原因分析',
      hypotheses: [
        {
          name: '日米相関の構造変化',
          probability: '高',
          description: '2018 年以降、日米業種相関が弱体化。米国中心の経済→日本への伝播メカニズムが変化。',
          evidence: '論文（2010-2025）では SR 2.22、本実装（2018-2025）では SR -0.12'
        },
        {
          name: 'データ期間不足',
          probability: '中',
          description: '日本 ETF データは 2018 年以降のみ（約 1,500 日）。統計的有意性確保に不十分。',
          evidence: '最低 3,000 日（約 12 年）推奨'
        },
        {
          name: '為替影響の考慮不足',
          probability: '中',
          description: 'USD/JPY の変動が戦略パフォーマンスに与える影響を考慮していない。',
          evidence: '2021-2022 年の円安局面でパフォーマンス悪化'
        }
      ]
    },
    recommendations: {
      shortTerm: {
        title: '短期（1-2 ヶ月）',
        actions: [
          {
            priority: 1,
            action: 'TOPIX 業種別指数での長期検証',
            expectedEffect: '2010 年以降のデータで統計的有意性確保',
            effort: '中'
          },
          {
            priority: 2,
            action: '為替ファクターの正式実装',
            expectedEffect: 'USD/JPY リターンを特徴量に追加',
            effort: '小'
          },
          {
            priority: 3,
            action: '市場環境フィルタの高度化',
            expectedEffect: 'VIX、金利スプレッドの追加',
            effort: '中'
          }
        ]
      },
      mediumTerm: {
        title: '中期（3-6 ヶ月）',
        actions: [
          {
            priority: 1,
            action: 'マルチファクターモデルの導入',
            expectedEffect: 'バリュー・クオリティ・モメンタムファクター追加',
            effort: '大'
          },
          {
            priority: 2,
            action: '機械学習による市場環境予測',
            expectedEffect: 'LSTM 等によるレジーム予測',
            effort: '大'
          },
          {
            priority: 3,
            action: '動的パラメータ調整',
            expectedEffect: '市場環境に応じてλ・分位点を自動調整',
            effort: '中'
          }
        ]
      },
      decisionMatrix: {
        title: '意思決定マトリックス',
        scenarios: [
          {
            name: 'A: 継続',
            condition: '長期検証でシャープレシオ > 1.0',
            action: '現行戦略で実運用準備'
          },
          {
            name: 'B: 改良',
            condition: '特定期間でシャープレシオ > 0',
            action: '市場環境フィルタ強化'
          },
          {
            name: 'C: 見直し',
            condition: '全期間でシャープレシオ < 0',
            action: '代替戦略へ移行'
          },
          {
            name: 'D: 撤退',
            condition: 'どの戦略も機能せず',
            action: 'プロジェクト終了'
          }
        ],
        currentStatus: 'C（見直し）に近い'
      }
    },
    targetKPIs: {
      title: '目標 KPI',
      metrics: [
        { name: 'シャープレシオ', current: -0.12, target3m: -1.0, target6m: 0.5 },
        { name: '最大ドローダウン', current: '-10.75%', target3m: '< -30%', target6m: '< -20%' },
        { name: '年率リターン', current: '-0.43%', target3m: '> -10%', target6m: '> 5%' },
        { name: '勝率', current: '50.2%', target3m: '> 45%', target6m: '> 50%' }
      ]
    },
    nextSteps: {
      title: '次のステップ',
      immediate: [
        'TOPIX 業種別指数のデータ取得（日本取引所グループ）',
        '為替データ（USD/JPY）の取得',
        'VIX 指数・金利スプレッドデータの取得'
      ],
      scripts: [
        'node scripts/data_source_parity.js - データソース確認',
        'node scripts/long_term_backtest.js - 長期バックテスト（再実行）',
        'node scripts/strategy_status.js - 戦略状態確認'
      ]
    }
  };

  // JSON レポート保存
  const jsonPath = path.join(REPORT_DIR, 'optimization_final_report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`💾 JSON レポートを保存しました：${jsonPath}`);

  // Markdown レポート生成
  const mdReport = generateMarkdownReport(report);
  const mdPath = path.join(REPORT_DIR, 'optimization_final_report.md');
  fs.writeFileSync(mdPath, mdReport);
  console.log(`📄 Markdown レポートを保存しました：${mdPath}`);

  return report;
}

function generateMarkdownReport(report) {
  return `# ${report.title}

**生成日**: ${report.generatedAt}

---

## エグゼクティブサマリー

### 総合評価: ${report.executiveSummary.conclusion}

#### 主要な発見
${report.executiveSummary.keyFindings.map(f => `- ${f}`).join('\n')}

#### 推奨事項
**${report.executiveSummary.recommendation}**

---

## Phase 1: 実装検証

**ステータス**: ✅ 完了

### パラメータ設定
| パラメータ | 値 |
|-----------|-----|
| Window Length | ${report.phase1_verification.findings.parameters.windowLength} |
| N Factors | ${report.phase1_verification.findings.parameters.nFactors} |
| Lambda Reg | ${report.phase1_verification.findings.parameters.lambdaReg} |
| Quantile | ${report.phase1_verification.findings.parameters.quantile} |

### 検証結果
- **ルックアヘッドバイアス**: ${report.phase1_verification.findings.lookaheadBias}
- **取引コスト**: ${report.phase1_verification.findings.transactionCosts}
- **シグナル計算**: ${report.phase1_verification.findings.signalCalculation}

### 簡易バックテスト（100 日サンプル）
| 指標 | 値 |
|------|-----|
| 年率リターン | ${report.phase1_verification.simpleBacktest.AR} |
| 年率リスク | ${report.phase1_verification.simpleBacktest.risk} |
| シャープレシオ | ${report.phase1_verification.simpleBacktest.sharpe} |
| 最大 DD | ${report.phase1_verification.simpleBacktest.mdd} |
| 勝率 | ${report.phase1_verification.simpleBacktest.winRate} |

---

## Phase 2: 長期バックテスト

**ステータス**: ✅ 完了

### 期間
${report.phase2_longTermBacktest.period}

### 全体パフォーマンス
| 指標 | 値 |
|------|-----|
| 年率リターン | ${report.phase2_longTermBacktest.overallPerformance.AR} |
| 年率リスク | ${report.phase2_longTermBacktest.overallPerformance.risk} |
| シャープレシオ | ${report.phase2_longTermBacktest.overallPerformance.sharpe} |
| 最大 DD | ${report.phase2_longTermBacktest.overallPerformance.mdd} |
| 累積リターン | ${report.phase2_longTermBacktest.overallPerformance.cumulative} |
| 勝率 | ${report.phase2_longTermBacktest.overallPerformance.winRate} |

### 年別パフォーマンス
| 年 | AR | シャープレシオ | 最大 DD |
|-----|------|---------------|---------|
${report.phase2_longTermBacktest.yearlyPerformance.map(y => `| ${y.year} | ${y.AR} | ${y.sharpe} | ${y.mdd} |`).join('\n')}

### 主要な知見
${report.phase2_longTermBacktest.keyInsights.map(i => `- ${i}`).join('\n')}

---

## Phase 3: 戦略改良

**ステータス**: ✅ 完了

### 実装フィルタ
| フィルタ | 設定 | 効果 |
|----------|------|------|
| 為替ヘッジ | ${report.phase3_improvedStrategy.filters.fxHedge.enabled ? 'ON' : 'OFF'} (threshold: ${report.phase3_improvedStrategy.filters.fxHedge.threshold}) | ${report.phase3_improvedStrategy.filters.fxHedge.effect} |
| ボラティリティ調整 | ${report.phase3_improvedStrategy.filters.volatilityAdjustment.enabled ? 'ON' : 'OFF'} (target: ${report.phase3_improvedStrategy.filters.volatilityAdjustment.targetVol}) | ${report.phase3_improvedStrategy.filters.volatilityAdjustment.effect} |
| 市場環境フィルタ | ${report.phase3_improvedStrategy.filters.marketFilter.enabled ? 'ON' : 'OFF'} (bull: ${report.phase3_improvedStrategy.filters.marketFilter.bull}, bear: ${report.phase3_improvedStrategy.filters.marketFilter.bear}) | ${report.phase3_improvedStrategy.filters.marketFilter.effect} |

### パフォーマンス比較
| 指標 | 従来版 | 改良版 | 改善幅 |
|------|--------|--------|--------|
| 年率リターン | ${report.phase3_improvedStrategy.comparison.baseline.AR} | ${report.phase3_improvedStrategy.comparison.improved.AR} | ${report.phase3_improvedStrategy.comparison.improvement.AR} |
| シャープレシオ | ${report.phase3_improvedStrategy.comparison.baseline.sharpe} | ${report.phase3_improvedStrategy.comparison.improved.sharpe} | ${report.phase3_improvedStrategy.comparison.improvement.sharpe} |
| 最大 DD | ${report.phase3_improvedStrategy.comparison.baseline.mdd} | ${report.phase3_improvedStrategy.comparison.improved.mdd} | ${report.phase3_improvedStrategy.comparison.improvement.mdd} |

### 主要な知見
${report.phase3_improvedStrategy.keyInsights.map(i => `- ${i}`).join('\n')}

---

## Phase 4: 総合評価

### 評価スコア
| 評価項目 | 得点 | 最大 | 詳細 |
|----------|------|------|------|
${Object.entries(report.phase4_finalEvaluation.scores).map(([k, v]) => `| ${k} | ${v.score} | ${v.max} | ${v.reason} |`).join('\n')}
| **合計** | **${report.phase4_finalEvaluation.totalScore.score}** | **${report.phase4_finalEvaluation.totalScore.max}** | **${report.phase4_finalEvaluation.totalScore.percentage}** |

---

## 根本原因分析

${report.rootCauseAnalysis.hypotheses.map((h, i) => `### ${i + 1}. ${h.name}
- **確度**: ${h.probability}
- **説明**: ${h.description}
- **証拠**: ${h.evidence}
`).join('\n')}

---

## 推奨アクション

### ${report.recommendations.shortTerm.title}
${report.recommendations.shortTerm.actions.map((a, i) => `
${i + 1}. **${a.action}**
   - 期待効果：${a.expectedEffect}
   - 工数：${a.effort}
`).join('\n')}

### ${report.recommendations.mediumTerm.title}
${report.recommendations.mediumTerm.actions.map((a, i) => `
${i + 1}. **${a.action}**
   - 期待効果：${a.expectedEffect}
   - 工数：${a.effort}
`).join('\n')}

### ${report.recommendations.decisionMatrix.title}
| シナリオ | 条件 | アクション |
|----------|------|------------|
${report.recommendations.decisionMatrix.scenarios.map(s => `| **${s.name}** | ${s.condition} | ${s.action} |`).join('\n')}

**現状**: **${report.recommendations.decisionMatrix.currentStatus}**

---

## 目標 KPI

| 指標 | 現状 | 3 ヶ月目標 | 6 ヶ月目標 |
|------|------|----------|----------|
${report.targetkpis.metrics.map(m => `| ${m.name} | ${m.current} | ${m.target3m} | ${m.target6m} |`).join('\n')}

---

## 次のステップ

### 即時対応
${report.nextsteps.immediate.map(s => `- ${s}`).join('\n')}

### 使用スクリプト
${report.nextsteps.scripts.map(s => `- \`${s}\``).join('\n')}

---

## 添付ファイル

- \`results/optimization_final_report.json\` - 詳細 JSON レポート
- \`results/long_term_backtest_report.json\` - 長期バックテスト結果
- \`results/improved_strategy_report.json\` - 戦略改良版結果

---

**更新履歴**:
- ${report.generatedAt.split('T')[0]}: 初版作成
`.trim();
}

// メイン処理
console.log('='.repeat(80));
console.log('戦略最適化 - 最終レポート生成');
console.log('='.repeat(80));

try {
  const report = generateReport();
  
  console.log('\n' + '='.repeat(80));
  console.log('レポート生成完了');
  console.log('='.repeat(80));
  
  console.log(`\n📊 総合評価：${report.phase4_finalEvaluation.totalScore.percentage}`);
  console.log(`📈 推奨事項：${report.executiveSummary.recommendation}`);
  console.log('📁 保存先：results/optimization_final_report.*');
  
  console.log('\n' + '='.repeat(80));
  console.log('最適化作業 完了');
  console.log('='.repeat(80));
  console.log('全 4 フェーズを完了しました。');
  console.log('詳細は results/optimization_final_report.md をご覧ください。');
} catch (error) {
  console.error('エラー:', error.message);
  console.error(error.stack);
  process.exit(1);
}
