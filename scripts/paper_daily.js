#!/usr/bin/env node
'use strict';

/**
 * signal.json を読みペーパー・ジャーナルに追記し、卒業ゲートを評価する。
 * 先に npm run signal（または workflow 内のシグナル）が必要。
 */

const { config } = require('../lib/config');
const { sendNotification } = require('../lib/ops/notifier');
const { runPaperDaily } = require('../lib/paper/daily');

async function main() {
  const status = await runPaperDaily({
    outputDir: config.data.outputDir,
    gatesPath: process.env.PAPER_GATES_PATH || undefined,
    sendNotification,
    config
  });

  if (status.skipped) {
    console.log(`\n[paper] スキップ: ${status.reason}`);
    if (status.detail) console.log(`  詳細: ${status.detail}`);
    return;
  }

  console.log(`\n[paper] ジャーナル更新: ${status.appendReason}（追記: ${status.appended ? 'はい' : 'いいえ'}）`);
  console.log(`  件数: ${status.journalStats.entryCount} / ユニーク日: ${status.journalStats.uniqueSignalDates} / リバランス相当: ${status.journalStats.rebalanceCount}`);

  const g = status.gates;
  if (g && g.checks) {
    console.log('\n[paper] 卒業ゲート（機械チェック・投資助言ではありません）');
    for (const c of g.checks) {
      console.log(`  ${c.pass ? '✓' : '×'} ${c.label} （現在: ${JSON.stringify(c.current)}）`);
    }
    console.log(`\n  総合: ${g.allPass ? '条件達成' : '未達'}`);
    if (g.allPass) {
      console.log('  （達成＝実弾推奨ではありません。自己責任で判断してください。）');
    }
  }
}

main().catch((e) => {
  console.error('[paper_daily]', e);
  process.exit(1);
});
