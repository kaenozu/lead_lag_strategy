'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function defaultGates() {
  return {
    minJournalEntries: 5,
    minUniqueSignalDates: 3,
    minRebalances: 2,
    maxBacktestAgeDays: 0,
    requireBacktestSummaryFile: false
  };
}

function loadPaperGates(gatesPath) {
  const resolved = gatesPath || path.join(PROJECT_ROOT, 'config', 'paper-gates.json');
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const g = JSON.parse(raw);
    return { ...defaultGates(), ...g };
  } catch {
    return defaultGates();
  }
}

function backtestSummaryAgeDays(outputDir) {
  const p = path.join(outputDir, 'backtest_summary_real.csv');
  try {
    const st = fs.statSync(p);
    return (Date.now() - st.mtimeMs) / (86400 * 1000);
  } catch {
    return null;
  }
}

function backtestSummaryExists(outputDir) {
  return fs.existsSync(path.join(outputDir, 'backtest_summary_real.csv'));
}

/**
 * @param {object} stats - journalStats()
 * @param {object} gates - loadPaperGates()
 * @param {string} outputDir - results
 */
function evaluatePaperGates(stats, gates, outputDir) {
  const checks = [];

  const okEntries = stats.entryCount >= gates.minJournalEntries;
  checks.push({
    id: 'minJournalEntries',
    label: `ジャーナル件数 ≥ ${gates.minJournalEntries}`,
    current: stats.entryCount,
    pass: okEntries
  });

  const okDates = stats.uniqueSignalDates >= gates.minUniqueSignalDates;
  checks.push({
    id: 'minUniqueSignalDates',
    label: `ユニークなシグナル日 ≥ ${gates.minUniqueSignalDates}`,
    current: stats.uniqueSignalDates,
    pass: okDates
  });

  const okReb = stats.rebalanceCount >= gates.minRebalances;
  checks.push({
    id: 'minRebalances',
    label: `構成変更回数（連続比較） ≥ ${gates.minRebalances}`,
    current: stats.rebalanceCount,
    pass: okReb
  });

  let okBacktestAge = true;
  let backtestAgeDays = null;
  if (gates.maxBacktestAgeDays > 0) {
    backtestAgeDays = backtestSummaryAgeDays(outputDir);
    okBacktestAge =
      backtestAgeDays !== null && backtestAgeDays <= gates.maxBacktestAgeDays;
    checks.push({
      id: 'maxBacktestAgeDays',
      label: `バックテスト要約の経過 ≤ ${gates.maxBacktestAgeDays} 日`,
      current: backtestAgeDays === null ? 'ファイルなし' : Number(backtestAgeDays.toFixed(2)),
      pass: okBacktestAge
    });
  }

  let okFile = true;
  if (gates.requireBacktestSummaryFile) {
    okFile = backtestSummaryExists(outputDir);
    checks.push({
      id: 'requireBacktestSummaryFile',
      label: 'backtest_summary_real.csv が存在',
      current: okFile ? 'あり' : 'なし',
      pass: okFile
    });
  }

  const allPass = checks.every((c) => c.pass);
  return {
    allPass,
    checks,
    backtestAgeDays,
    disclosure:
      '卒業チェックは自己設定の機械的条件のみです。実弾の可否・損失は自己責任です。'
  };
}

module.exports = {
  defaultGates,
  loadPaperGates,
  evaluatePaperGates,
  backtestSummaryAgeDays,
  backtestSummaryExists
};
