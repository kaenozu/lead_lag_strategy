'use strict';

const CUSTOM_HOLIDAYS = {
  US: new Set([]),
  JP: new Set([])
};

function addHoliday(date, market) {
  const d = new Date(date);
  const dateStr = d.toISOString().split('T')[0];
  if (CUSTOM_HOLIDAYS[market]) {
    CUSTOM_HOLIDAYS[market].add(dateStr);
  }
}

function isTradingDay(date, market = 'JP') {
  const d = new Date(date + 'T00:00:00Z');
  const dayOfWeek = d.getUTCDay();
  const dayOfMonth = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const dateStr = d.toISOString().split('T')[0];

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  if (CUSTOM_HOLIDAYS[market] && CUSTOM_HOLIDAYS[market].has(dateStr)) {
    return false;
  }

  if (market === 'US') {
    if (month === 1 && dayOfMonth === 1) return false;
    if (month === 7 && dayOfMonth === 4) return false;
    if (month === 12 && dayOfMonth === 25) return false;
    if (month === 1 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 2 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 5 && dayOfMonth >= 25 && dayOfWeek === 1) return false;
    if (month === 9 && dayOfMonth <= 7 && dayOfWeek === 1) return false;
    if (month === 11 && dayOfMonth >= 22 && dayOfMonth <= 28 && dayOfWeek === 4) return false;
    return true;
  }

  if (market === 'JP') {
    if (month === 1 && dayOfMonth <= 3) return false;
    if (month === 2 && dayOfMonth === 11) return false;
    if (month === 2 && dayOfMonth === 23) return false;
    if (month === 3 && (dayOfMonth === 20 || dayOfMonth === 21)) return false;
    if (month === 4 && dayOfMonth === 29) return false;
    if (month === 5 && dayOfMonth === 3) return false;
    if (month === 5 && dayOfMonth === 5) return false;
    if (month === 8 && dayOfMonth === 11) return false;
    if (month === 11 && dayOfMonth === 3) return false;
    if (month === 11 && dayOfMonth === 23) return false;
    if (month === 1 && dayOfMonth >= 8 && dayOfMonth <= 14 && dayOfWeek === 1) return false;
    if (month === 7 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 9 && dayOfMonth >= 15 && dayOfMonth <= 21 && dayOfWeek === 1) return false;
    if (month === 10 && dayOfMonth >= 8 && dayOfMonth <= 14 && dayOfWeek === 1) return false;
    if (month === 9 && (dayOfMonth === 22 || dayOfMonth === 23)) return false;
    return true;
  }

  return true;
}

function filterTradingDays(dates, market = 'JP') {
  return dates.filter(date => isTradingDay(date, market));
}

function clearCustomHolidays(market) {
  if (market && CUSTOM_HOLIDAYS[market]) {
    CUSTOM_HOLIDAYS[market].clear();
  } else if (!market) {
    for (const m of Object.keys(CUSTOM_HOLIDAYS)) {
      CUSTOM_HOLIDAYS[m].clear();
    }
  }
}

module.exports = {
  isTradingDay,
  filterTradingDays,
  addHoliday,
  clearCustomHolidays
};
