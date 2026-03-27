#!/usr/bin/env node
'use strict';

const path = require('path');
const { config } = require('../lib/config');
const { loadJournal, journalStats } = require('../lib/paper/journal');
const { loadPaperGates, evaluatePaperGates } = require('../lib/paper/gates');

function main() {
  const outputDir = path.resolve(config.data.outputDir);
  const journalPath = process.env.PAPER_JOURNAL_PATH || path.join(outputDir, 'paper_journal.json');
  const gatesPath = process.env.PAPER_GATES_PATH || path.join(path.resolve(__dirname, '..'), 'config', 'paper-gates.json');

  const journal = loadJournal(journalPath);
  const stats = journalStats(journal);
  const gates = loadPaperGates(gatesPath);
  const evaluation = evaluatePaperGates(stats, gates, outputDir);

  console.log(JSON.stringify({ journalPath, stats, gates, evaluation }, null, 2));
  process.exit(evaluation.allPass ? 0 : 0);
}

main();
