'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadJournal,
  saveJournal,
  appendIfNew,
  journalStats,
  buildEntryFromSignal,
  signalFingerprint
} = require('../../../lib/paper/journal');

describe('lib/paper/journal', () => {
  test('signalFingerprint is stable', () => {
    const a = signalFingerprint(['1618.T', '1617.T'], ['1621.T']);
    const b = signalFingerprint(['1617.T', '1618.T'], ['1621.T']);
    expect(a).toBe(b);
  });

  test('appendIfNew dedupes same signal day and fingerprint', () => {
    const j = loadJournal(path.join(os.tmpdir(), 'nope-no-file'));
    const e1 = {
      recordedAt: '2025-03-01T10:00:00Z',
      signalDate: '2025-02-28',
      fingerprint: 'abc',
      buyTickers: ['1618.T'],
      sellTickers: ['1621.T'],
      configSnapshot: {}
    };
    let r = appendIfNew(j, e1);
    expect(r.appended).toBe(true);
    r = appendIfNew(r.journal, { ...e1, recordedAt: '2025-03-01T11:00:00Z' });
    expect(r.appended).toBe(false);
    expect(r.journal.entries).toHaveLength(1);
  });

  test('journalStats counts rebalances', () => {
    const j = {
      version: 1,
      startedAt: 'x',
      entries: [
        { fingerprint: 'a', signalDate: '2025-01-01' },
        { fingerprint: 'a', signalDate: '2025-01-02' },
        { fingerprint: 'b', signalDate: '2025-01-03' }
      ]
    };
    const s = journalStats(j);
    expect(s.entryCount).toBe(3);
    expect(s.uniqueSignalDates).toBe(3);
    expect(s.rebalanceCount).toBe(1);
  });

  test('buildEntryFromSignal maps candidates', () => {
    const doc = {
      latestDate: '2025-03-20',
      buyCandidates: [{ ticker: '1618.T' }],
      sellCandidates: [{ ticker: '1621.T' }],
      config: { windowLength: 60, lambdaReg: 0.9, quantile: 0.4 }
    };
    const e = buildEntryFromSignal(doc);
    expect(e.buyTickers).toEqual(['1618.T']);
    expect(e.sellTickers).toEqual(['1621.T']);
    expect(e.signalDate).toBe('2025-03-20');
  });

  test('save and load roundtrip', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-j-'));
    const p = path.join(dir, 'paper_journal.json');
    const j = { version: 1, startedAt: 't', entries: [] };
    saveJournal(p, j);
    const j2 = loadJournal(p);
    expect(j2.entries).toEqual([]);
  });
});
