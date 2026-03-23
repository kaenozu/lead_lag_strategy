'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const logger = createLogger('DataUtils');

function parseCSV(csvText) {
  try {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have at least a header and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length !== headers.length) {
        logger.warn(`Skipping row ${i}: column count mismatch`);
        continue;
      }

      const row = {};
      const isDateString = (str) => {
        if (!str.includes('-')) return false;
        const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return false;
        const [, , month, day] = match;
        const m = parseInt(month, 10);
        const d = parseInt(day, 10);
        return m >= 1 && m <= 12 && d >= 1 && d <= 31;
      };

      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        const val = values[j]?.trim();
        if (val === undefined || val === '') {
          row[key] = null;
          continue;
        }
        const numVal = parseFloat(val);
        const isDate = isDateString(val);
        if (isNaN(numVal) || isDate) {
          row[key] = val;
        } else {
          row[key] = numVal;
        }
      }
      data.push(row);
    }

    return data;
  } catch (error) {
    logger.error('Failed to parse CSV', { error: error.message });
    throw error;
  }
}

function loadCSV(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return parseCSV(content);
  } catch (error) {
    logger.error('Failed to load CSV', { filePath, error: error.message });
    throw error;
  }
}

function saveCSV(filePath, data, headers = null) {
  try {
    if (!data || data.length === 0) {
      throw new Error('No data to save');
    }

    const cols = headers || Object.keys(data[0]);
    const lines = [cols.join(',')];

    for (const row of data) {
      const values = cols.map(col => {
        const val = row[col];
        return val !== undefined && val !== null ? String(val) : '';
      });
      lines.push(values.join(','));
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    logger.info('CSV saved successfully', { filePath, rows: data.length });
  } catch (error) {
    logger.error('Failed to save CSV', { filePath, error: error.message });
    throw error;
  }
}

module.exports = {
  parseCSV,
  loadCSV,
  saveCSV
};
