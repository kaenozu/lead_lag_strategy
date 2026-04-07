'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_GATES_FILENAME = 'paper-gates.json';

function defaultGates() {
  return {
    minJournalEntries: 5,
    minUniqueSignalDates: 3,
    minRebalances: 2,
    maxBacktestAgeDays: 0,
    requireBacktestSummaryFile: false
  };
}

function resolvePaperGatesPath(gatesPath) {
  return gatesPath || path.join(PROJECT_ROOT, 'config', DEFAULT_GATES_FILENAME);
}

function readPaperGatesFile(resolvedPath) {
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Failed to load paper gates from ${resolvedPath}: ${error.message}`);
    return null;
  }
}

function loadPaperGates(gatesPath) {
  const resolvedPath = resolvePaperGatesPath(gatesPath);
  const userGates = readPaperGatesFile(resolvedPath);
  if (!userGates) {
    return defaultGates();
  }
  return { ...defaultGates(), ...userGates };
}

function backtestSummaryAgeDays(outputDir) {
  const summaryPath = path.join(outputDir, 'backtest_summary_real.csv');
  try {
    const stat = fs.statSync(summaryPath);
    return (Date.now() - stat.mtimeMs) / (86400 * 1000);
  } catch {
    return null;
  }
}

function backtestSummaryExists(outputDir) {
  return fs.existsSync(path.join(outputDir, 'backtest_summary_real.csv'));
}

function makeCheck(id, label, current, pass) {
  return { id, label, current, pass };
}

/**
 * @param {object} stats - journalStats()
 * @param {object} gates - loadPaperGates()
 * @param {string} outputDir - results directory
 */
function evaluatePaperGates(stats, gates, outputDir) {
  const checks = [
    makeCheck(
      'minJournalEntries',
      `Journal entries >= ${gates.minJournalEntries}`,
      stats.entryCount,
      stats.entryCount >= gates.minJournalEntries
    ),
    makeCheck(
      'minUniqueSignalDates',
      `Unique signal dates >= ${gates.minUniqueSignalDates}`,
      stats.uniqueSignalDates,
      stats.uniqueSignalDates >= gates.minUniqueSignalDates
    ),
    makeCheck(
      'minRebalances',
      `Rebalances >= ${gates.minRebalances}`,
      stats.rebalanceCount,
      stats.rebalanceCount >= gates.minRebalances
    )
  ];

  let backtestAgeDays = null;
  if (gates.maxBacktestAgeDays > 0) {
    backtestAgeDays = backtestSummaryAgeDays(outputDir);
    const okBacktestAge =
      backtestAgeDays !== null && backtestAgeDays <= gates.maxBacktestAgeDays;
    checks.push(
      makeCheck(
        'maxBacktestAgeDays',
        `Backtest summary age <= ${gates.maxBacktestAgeDays} days`,
        backtestAgeDays === null ? 'missing' : Number(backtestAgeDays.toFixed(2)),
        okBacktestAge
      )
    );
  }

  if (gates.requireBacktestSummaryFile) {
    const exists = backtestSummaryExists(outputDir);
    checks.push(
      makeCheck(
        'requireBacktestSummaryFile',
        'backtest_summary_real.csv exists',
        exists ? 'yes' : 'no',
        exists
      )
    );
  }

  const allPass = checks.every((check) => check.pass);
  return {
    allPass,
    checks,
    backtestAgeDays,
    disclosure:
      'Paper gates are intentionally operational checks only. They do not validate trading performance or correctness.'
  };
}

module.exports = {
  defaultGates,
  loadPaperGates,
  evaluatePaperGates,
  backtestSummaryAgeDays,
  backtestSummaryExists,
  resolvePaperGatesPath,
  readPaperGatesFile
};
