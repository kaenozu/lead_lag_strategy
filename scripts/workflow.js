/**
 * 推奨作業の一括実行（タスクスケジューラ / cron 向け）
 *
 * 既定: doctor（軽量）→ CLI シグナル → 戦略検証（GO/STOP）→ ペーパー・ジャーナル
 *       （バックテストは省略＝毎日回しやすい）
 * 初回・パラメータ変更後: --with-backtest / --doctor-full を付与
 *
 * 例:
 *   npm run workflow
 *   npm run workflow -- --with-backtest
 *   npm run workflow -- --doctor-full --with-backtest
 *   npm run workflow -- --skip-paper --no-signal
 *   npm run workflow -- --skip-strategy-status
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function run(label, cmd, args) {
  console.log(`\n── ${label} ──\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  const code = r.status === null ? 1 : r.status;
  if (code !== 0) {
    console.error(`\n[workflow] 失敗: ${label} (exit ${code})\n`);
  }
  return code;
}

function main() {
  const argv = process.argv.slice(2);
  const withBacktest = argv.includes('--with-backtest');
  const fullDoctor = argv.includes('--doctor-full');
  const skipPaper = argv.includes('--skip-paper');
  const noSignal = argv.includes('--no-signal');
  const skipStrategyStatus = argv.includes('--skip-strategy-status');

  console.log('='.repeat(60));
  console.log('lead_lag_strategy — 自動ワークフロー (npm run workflow)');
  console.log('='.repeat(60));
  console.log('（表の見方・買ったあとは Web の「表の見方と、買ったあとの流れ」にあります）');
  if (!withBacktest) {
    console.log('（バックテスト省略中。初回や設定変更後は --with-backtest を付けてください）');
  }

  const doctorArgs = fullDoctor ? [] : ['--light'];
  let code = run('環境チェック (doctor)', 'node', ['scripts/doctor.js', ...doctorArgs]);
  if (code !== 0) {
    process.exit(code);
  }

  if (withBacktest) {
    code = run('バックテスト (real)', 'node', ['backtest/real.js']);
    if (code !== 0) {
      process.exit(code);
    }
  } else {
    console.log('\n── バックテスト ──\n（スキップ。必要なときだけ npm run workflow -- --with-backtest）\n');
  }

  if (!noSignal) {
    code = run('本日シグナル (CLI)', 'node', ['src/generate_signal.js']);
    if (code !== 0) {
      process.exit(code);
    }
  }

  if (!skipStrategyStatus) {
    code = run('戦略検証 (GO/STOP)', 'node', ['scripts/strategy_status.js']);
    // strategy_status は STOP 時に非ゼロ終了する。
    // 運用上の判定結果として表示し、ワークフロー自体は継続する。
    if (code !== 0) {
      console.log('\n[workflow] 戦略検証の判定は STOP でした（処理は継続します）。');
    }
  } else {
    console.log('\n── 戦略検証 ──\n（スキップ。必要なときは npm run strategy:status）\n');
  }

  if (!skipPaper) {
    code = run('ペーパー・ジャーナル', 'node', ['scripts/paper_daily.js']);
    if (code !== 0) {
      process.exit(code);
    }
    const statusPath = path.join(root, 'results', 'paper_verification_status.json');
    try {
      const st = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      if (st.graduationReady) {
        console.log(
          '\n[workflow] ペーパー検証: 設定した卒業ゲートをすべて満たしました（＝実弾推奨ではありません）。\n'
        );
      }
    } catch {
      // 無視
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('ワークフロー完了（確認はブラウザの当該画面でも可）');
  console.log('='.repeat(60));
}

main();
