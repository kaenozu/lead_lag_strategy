'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadJournal,
  saveJournal,
  buildEntryFromSignal,
  appendIfNew,
  journalStats
} = require('./journal');
const { loadPaperGates, evaluatePaperGates } = require('./gates');

function readSignalJson(signalPath) {
  try {
    const raw = fs.readFileSync(signalPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeVerificationStatus(outputDir, payload) {
  const p = path.join(outputDir, 'paper_verification_status.json');
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return p;
}

/**
 * @param {object} opts
 * @param {string} opts.outputDir
 * @param {string} [opts.signalPath]
 * @param {string} [opts.journalPath]
 * @param {string} [opts.gatesPath]
 * @param {function} [opts.sendNotification] async ({ channel, message, context, config }) => void
 * @param {object} [opts.config] lib/config
 */
async function runPaperDaily(opts) {
  const outputDir = path.resolve(opts.outputDir || './results');
  const signalPath = opts.signalPath || path.join(outputDir, 'signal.json');
  const journalPath = opts.journalPath || path.join(outputDir, 'paper_journal.json');

  const signalDoc = readSignalJson(signalPath);
  if (!signalDoc) {
    const status = {
      at: new Date().toISOString(),
      skipped: true,
      reason: 'signal.json が読めません（先に npm run signal または workflow）',
      journalStats: null,
      gates: null
    };
    writeVerificationStatus(outputDir, status);
    return status;
  }

  if (signalDoc.error || (Array.isArray(signalDoc.signals) && signalDoc.signals.length === 0)) {
    const status = {
      at: new Date().toISOString(),
      skipped: true,
      reason: 'signal.json に有効なシグナルがありません',
      detail: signalDoc.error || signalDoc.detail,
      journalStats: null,
      gates: null
    };
    writeVerificationStatus(outputDir, status);
    return status;
  }

  const journal = loadJournal(journalPath);
  const entry = buildEntryFromSignal(signalDoc);
  const prevLast = journal.entries[journal.entries.length - 1];
  const { journal: nextJournal, appended, reason } = appendIfNew(journal, entry);

  if (appended && opts.sendNotification && opts.config) {
    const ch = String(opts.config.operations.notificationChannel || 'log').toLowerCase();
    const wantChange =
      opts.config.operations.notifyOnSignalChange &&
      prevLast &&
      prevLast.fingerprint !== entry.fingerprint;
    if (wantChange) {
      await opts.sendNotification({
        channel: ch === 'webhook' ? 'webhook' : 'log',
        level: 'info',
        message: 'シグナル構成が前回から変化しました（ペーパー・ジャーナル追記）',
        context: {
          signalDate: entry.signalDate,
          buy: entry.buyTickers,
          sell: entry.sellTickers
        },
        config: opts.config
      });
    }
  }

  saveJournal(journalPath, nextJournal);
  const stats = journalStats(nextJournal);
  const gates = loadPaperGates(opts.gatesPath);
  const evaluation = evaluatePaperGates(stats, gates, outputDir);

  const status = {
    at: new Date().toISOString(),
    skipped: false,
    appendReason: reason,
    appended,
    journalPath,
    journalStats: stats,
    gates: evaluation,
    graduationReady: evaluation.allPass
  };
  writeVerificationStatus(outputDir, status);
  return status;
}

module.exports = {
  runPaperDaily,
  readSignalJson,
  writeVerificationStatus
};
