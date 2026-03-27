'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluatePaperGates, defaultGates, loadPaperGates } = require('../../../lib/paper/gates');

describe('lib/paper/gates', () => {
  test('evaluatePaperGates passes when thresholds met', () => {
    const stats = {
      entryCount: 10,
      uniqueSignalDates: 5,
      rebalanceCount: 3
    };
    const gates = {
      ...defaultGates(),
      minJournalEntries: 5,
      minUniqueSignalDates: 3,
      minRebalances: 2,
      maxBacktestAgeDays: 0,
      requireBacktestSummaryFile: false
    };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-g-'));
    const r = evaluatePaperGates(stats, gates, outDir);
    expect(r.allPass).toBe(true);
    expect(r.checks.length).toBeGreaterThanOrEqual(3);
  });

  test('requireBacktestSummaryFile fails without csv', () => {
    const stats = { entryCount: 99, uniqueSignalDates: 99, rebalanceCount: 99 };
    const gates = {
      ...defaultGates(),
      minJournalEntries: 1,
      minUniqueSignalDates: 1,
      minRebalances: 0,
      requireBacktestSummaryFile: true
    };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-g2-'));
    const r = evaluatePaperGates(stats, gates, outDir);
    expect(r.allPass).toBe(false);
  });

  test('maxBacktestAgeDays uses file mtime', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-g3-'));
    fs.writeFileSync(path.join(outDir, 'backtest_summary_real.csv'), 'x');
    const stats = { entryCount: 5, uniqueSignalDates: 3, rebalanceCount: 2 };
    const gates = {
      ...defaultGates(),
      minJournalEntries: 1,
      minUniqueSignalDates: 1,
      minRebalances: 0,
      maxBacktestAgeDays: 1,
      requireBacktestSummaryFile: false
    };
    const r = evaluatePaperGates(stats, gates, outDir);
    expect(r.allPass).toBe(true);
  });

  test('loadPaperGates warns and falls back to defaults when file is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gates = loadPaperGates(path.join(os.tmpdir(), 'no-such-paper-gates.json'));
      expect(gates).toEqual(defaultGates());
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
