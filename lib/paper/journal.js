'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOURNAL_VERSION = 1;

function defaultJournal() {
  return {
    version: JOURNAL_VERSION,
    startedAt: null,
    entries: []
  };
}

function signalFingerprint(buyTickers, sellTickers) {
  const payload = JSON.stringify({
    b: [...buyTickers].sort(),
    s: [...sellTickers].sort()
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function normalizeEntries(journal) {
  return Array.isArray(journal?.entries) ? journal.entries : [];
}

function hasDuplicateEntry(entries, entry) {
  return entries.some((existing) =>
    existing &&
    existing.signalDate === entry.signalDate &&
    existing.fingerprint === entry.fingerprint
  );
}

function entryDate(entry) {
  return (entry?.signalDate || entry?.recordedAt || '').slice(0, 10);
}

function countRebalances(entries) {
  let rebalances = 0;
  let prev = null;
  for (const entry of entries) {
    if (prev && entry.fingerprint !== prev.fingerprint) rebalances += 1;
    prev = entry;
  }
  return rebalances;
}

function loadJournal(journalPath) {
  try {
    const raw = fs.readFileSync(journalPath, 'utf8');
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.entries)) return defaultJournal();
    return { ...defaultJournal(), ...j, entries: j.entries };
  } catch {
    return defaultJournal();
  }
}

function saveJournal(journalPath, journal) {
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');
}

/**
 * @param {object} signalDoc - results/signal.json 相当
 * @returns {object|null} 追記するエントリ or スキップ時 null
 */
function buildEntryFromSignal(signalDoc) {
  if (!signalDoc || signalDoc.error) return null;
  const buys = (signalDoc.buyCandidates || []).map((x) => x.ticker).filter(Boolean);
  const sells = (signalDoc.sellCandidates || []).map((x) => x.ticker).filter(Boolean);
  if (buys.length === 0 && sells.length === 0) return null;

  const latestDate = signalDoc.latestDate || signalDoc.timestamp?.slice(0, 10) || null;
  const fp = signalFingerprint(buys, sells);
  const cfg = signalDoc.config || {};

  return {
    recordedAt: new Date().toISOString(),
    signalDate: latestDate,
    fingerprint: fp,
    buyTickers: buys,
    sellTickers: sells,
    configSnapshot: {
      windowLength: cfg.windowLength,
      lambdaReg: cfg.lambdaReg,
      quantile: cfg.quantile,
      nFactors: cfg.nFactors
    },
    sourceSummary: signalDoc.sourceSummary || null
  };
}

/**
 * 同一 signal 日・同一フィンガープリントなら追記しない（cron 多重実行対策）
 */
function appendIfNew(journal, entry) {
  if (!entry) return { journal, appended: false, reason: 'no_signal' };

  if (!journal.startedAt) journal.startedAt = entry.recordedAt;

  const entries = normalizeEntries(journal);
  if (hasDuplicateEntry(entries, entry)) {
    return { journal, appended: false, reason: 'duplicate_day' };
  }

  entries.push(entry);
  journal.entries = entries;
  return { journal, appended: true, reason: 'ok' };
}

function journalStats(journal) {
  const entries = normalizeEntries(journal);
  const dates = new Set(entries.map(entryDate).filter(Boolean));
  return {
    entryCount: entries.length,
    uniqueSignalDates: dates.size,
    rebalanceCount: countRebalances(entries),
    firstAt: entries[0]?.recordedAt || null,
    lastAt: entries[entries.length - 1]?.recordedAt || null
  };
}

module.exports = {
  defaultJournal,
  loadJournal,
  saveJournal,
  signalFingerprint,
  buildEntryFromSignal,
  appendIfNew,
  journalStats
};
