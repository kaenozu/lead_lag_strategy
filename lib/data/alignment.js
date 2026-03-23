'use strict';

function alignDates(usDates, jpDates) {
  if (!usDates || usDates.length === 0 || !jpDates || jpDates.length === 0) {
    return [];
  }

  const usSorted = [...usDates].sort();
  const jpSorted = [...jpDates].sort();
  const aligned = [];

  for (const jpDate of jpSorted) {
    const usDate = lastUsDateStrictlyBefore(usSorted, jpDate);
    if (usDate !== null) {
      aligned.push({ usDate, jpDate });
    }
  }

  return aligned;
}

function lastUsDateStrictlyBefore(usSortedAsc, jpDate) {
  let lo = 0;
  let hi = usSortedAsc.length - 1;
  let ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (usSortedAsc[mid] < jpDate) {
      ans = usSortedAsc[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function alignDatesLegacy(usDates, jpDates, options = {}) {
  const { lagDays = 1 } = options;

  if (!usDates || usDates.length === 0 || !jpDates || jpDates.length === 0) {
    return [];
  }

  const jpDateSet = new Set(jpDates);
  const aligned = [];

  for (let i = lagDays; i < usDates.length; i++) {
    const usDate = usDates[i - lagDays];
    const jpDate = usDates[i];

    if (jpDateSet.has(jpDate)) {
      aligned.push({ usDate, jpDate });
    }
  }

  return aligned;
}

function buildPaperAlignedReturnRows(usMap, jpCCMap, jpOCMap, usTickers, jpTickers, jpWindowReturn = 'cc') {
  const usDates = [...usMap.keys()].sort();
  const jpDates = [...jpCCMap.keys()].sort();
  const alignedDates = alignDates(usDates, jpDates);
  const jpWinMap = jpWindowReturn === 'oc' ? jpOCMap : jpCCMap;

  const retUs = [];
  const retJp = [];
  const retJpOc = [];
  const dates = [];

  for (const { usDate, jpDate } of alignedDates) {
    const usRow = usTickers.map(t => usMap.get(usDate)?.[t]);
    const jpRow = jpTickers.map(t => jpWinMap.get(jpDate)?.[t]);
    const jpOcRow = jpTickers.map(t => jpOCMap.get(jpDate)?.[t]);

    if (usRow.some(v => v === undefined) ||
        jpRow.some(v => v === undefined) ||
        jpOcRow.some(v => v === undefined)) {
      continue;
    }

    retUs.push({ date: usDate, values: usRow });
    retJp.push({ date: jpDate, values: jpRow });
    retJpOc.push({ date: jpDate, values: jpOcRow });
    dates.push(jpDate);
  }

  return { retUs, retJp, retJpOc, dates };
}

module.exports = {
  alignDates,
  alignDatesLegacy,
  buildPaperAlignedReturnRows
};
