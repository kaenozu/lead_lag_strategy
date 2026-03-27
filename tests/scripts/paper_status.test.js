'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('scripts/paper_status', () => {
  test('exits non-zero when gates fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-status-'));
    const journalPath = path.join(dir, 'paper_journal.json');
    const gatesPath = path.join(dir, 'paper-gates.json');

    fs.writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        startedAt: '2026-03-27T00:00:00Z',
        entries: [
          {
            recordedAt: '2026-03-27T00:00:00Z',
            signalDate: '2026-03-27',
            fingerprint: 'abc'
          }
        ]
      }),
      'utf8'
    );
    fs.writeFileSync(
      gatesPath,
      JSON.stringify({
        minJournalEntries: 2,
        minUniqueSignalDates: 2,
        minRebalances: 1,
        maxBacktestAgeDays: 0,
        requireBacktestSummaryFile: false
      }),
      'utf8'
    );

    const result = spawnSync(process.execPath, ['scripts/paper_status.js'], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: {
        ...process.env,
        PAPER_JOURNAL_PATH: journalPath,
        PAPER_GATES_PATH: gatesPath
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"allPass": false');
  });
});
