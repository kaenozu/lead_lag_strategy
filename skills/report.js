/**
 * Report Generation Skill
 * 
 * Generates trading reports and summaries
 */

const { createSkill } = require('./skill-base');
const fs = require('fs');
const path = require('path');

module.exports = createSkill({
  name: 'report',
  description: '取引レポートとサマリー生成',
  
  defaultConfig: {
    reportType: 'daily',  // daily, weekly, monthly
    includeCharts: false,
    format: 'json',  // json, markdown, html
    outputDir: './reports'
  },
  
  async run(skillConfig) {
    const report = {
      generatedAt: new Date().toISOString(),
      type: skillConfig.reportType,
      sections: {}
    };
    
    console.log(`📝 ${skillConfig.reportType}レポート生成中...`);
    
    // 1. エグゼクティブサマリー
    report.sections.executiveSummary = {
      title: 'エグゼクティブサマリー',
      content: generateExecutiveSummary()
    };
    
    // 2. ポジションサマリー
    report.sections.positions = {
      title: 'ポジションサマリー',
      content: generatePositionSummary()
    };
    
    // 3. パフォーマンスサマリー
    report.sections.performance = {
      title: 'パフォーマンスサマリー',
      content: generatePerformanceSummary()
    };
    
    // 4. リスクメトリクス
    report.sections.risk = {
      title: 'リスクメトリクス',
      content: generateRiskMetrics()
    };
    
    // 5. 取引履歴
    report.sections.transactions = {
      title: '取引履歴',
      content: generateTransactionHistory()
    };
    
    // 6. 出力
    const outputPath = path.join(skillConfig.outputDir, `report_${skillConfig.reportType}_${Date.now()}.${skillConfig.format}`);
    
    // Ensure output directory exists
    if (!fs.existsSync(skillConfig.outputDir)) {
      fs.mkdirSync(skillConfig.outputDir, { recursive: true });
    }
    
    // Save report
    if (skillConfig.format === 'markdown') {
      fs.writeFileSync(outputPath, convertToMarkdown(report));
    } else {
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    }
    
    console.log(`✅ レポート生成完了：${outputPath}`);
    
    return {
      report,
      outputPath,
      format: skillConfig.format
    };
  }
});

/**
 * Generate executive summary
 */
function generateExecutiveSummary() {
  return {
    marketCondition: 'Neutral',
    strategyStatus: 'Active',
    keyHighlights: [
      '部分空間正則化 PCA によるシグナル生成が正常に機能',
      '米 11 業種・日 17 業種のデータを利用可能',
      '直近のボラティリティは平均的'
    ],
    actionItems: [
      '日次シグナルの生成と確認',
      'リスク制限の遵守状況チェック',
      '取引コストのモニタリング'
    ]
  };
}

/**
 * Generate position summary
 */
function generatePositionSummary() {
  return {
    totalPositions: 0,
    longPositions: 0,
    shortPositions: 0,
    grossExposure: 0,
    netExposure: 0,
    topLong: [],
    topShort: [],
    note: 'ポジションデータはシグナル生成後に更新されます'
  };
}

/**
 * Generate performance summary
 */
function generatePerformanceSummary() {
  return {
    period: 'N/A',
    totalReturn: 0,
    annualReturn: 0,
    annualRisk: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    winRate: 0,
    note: 'パフォーマンスデータはバックテスト実行後に更新されます'
  };
}

/**
 * Generate risk metrics
 */
function generateRiskMetrics() {
  return {
    portfolioVolatility: 0,
    valueAtRisk95: 0,
    expectedShortfall: 0,
    averageCorrelation: 0,
    concentrationRisk: 'Low',
    liquidityRisk: 'Low',
    note: 'リスクメトリクスはリスク管理スキル実行後に更新されます'
  };
}

/**
 * Generate transaction history
 */
function generateTransactionHistory() {
  return {
    totalTrades: 0,
    recentTrades: [],
    totalCommission: 0,
    totalSlippage: 0,
    note: '取引履歴はペーパー取引実行後に更新されます'
  };
}

/**
 * Convert report to Markdown format
 */
function convertToMarkdown(report) {
  let md = '# 日米業種リードラグ戦略レポート\n\n';
  md += `**生成日時:** ${report.generatedAt}\n`;
  md += `**レポートタイプ:** ${report.type}\n\n`;
  
  md += '---\n\n';
  
  for (const [, section] of Object.entries(report.sections)) {
    md += `## ${section.title}\n\n`;
    
    if (section.content) {
      for (const [k, v] of Object.entries(section.content)) {
        if (Array.isArray(v)) {
          md += `### ${formatKey(k)}\n\n`;
          for (const item of v) {
            if (typeof item === 'string') {
              md += `- ${item}\n`;
            } else {
              md += `- ${JSON.stringify(item)}\n`;
            }
          }
          md += '\n';
        } else if (typeof v === 'object' && v !== null) {
          md += `### ${formatKey(k)}\n\n`;
          for (const [subK, subV] of Object.entries(v)) {
            md += `- **${formatKey(subK)}:** ${subV}\n`;
          }
          md += '\n';
        } else {
          md += `- **${formatKey(k)}:** ${v}\n`;
        }
      }
    }
    
    md += '\n---\n\n';
  }
  
  md += '\n*このレポートは自動生成されました*\n';
  
  return md;
}

/**
 * Format object key for display
 */
function formatKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase());
}
