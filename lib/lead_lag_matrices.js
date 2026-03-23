/**
 * ローカル OHLC からリードラグ用リターン行列を構築（JP OC は別マップ）
 */

'use strict';

const { alignDates, computeReturns } = require('./data');

/**
 * @param {Record<string, Array>} usData
 * @param {Record<string, Array>} jpData
 * @param {string[]} US_ETF_TICKERS
 * @param {string[]} JP_ETF_TICKERS
 * @param {{ minDate?: string }} opts
 */
function buildLeadLagMatrices(usData, jpData, US_ETF_TICKERS, JP_ETF_TICKERS, opts = {}) {
    const minDate = opts.minDate || null;

    const usCC = {};
    const jpCC = {};
    const jpOC = {};
    for (const t of US_ETF_TICKERS) {
        const d = usData[t] || [];
        usCC[t] = computeReturns(d, 'cc');
    }
    for (const t of JP_ETF_TICKERS) {
        const d = jpData[t] || [];
        jpCC[t] = computeReturns(d, 'cc');
        jpOC[t] = computeReturns(d, 'oc');
    }

    const usMap = new Map();
    const jpCCMap = new Map();
    const jpOCMap = new Map();

    for (const t of US_ETF_TICKERS) {
        for (const r of usCC[t]) {
            if (!usMap.has(r.date)) usMap.set(r.date, {});
            usMap.get(r.date)[t] = r.return;
        }
    }
    for (const t of JP_ETF_TICKERS) {
        for (const r of jpCC[t]) {
            if (!jpCCMap.has(r.date)) jpCCMap.set(r.date, {});
            jpCCMap.get(r.date)[t] = r.return;
        }
        for (const r of jpOC[t]) {
            if (!jpOCMap.has(r.date)) jpOCMap.set(r.date, {});
            jpOCMap.get(r.date)[t] = r.return;
        }
    }

    const usDates = [...usMap.keys()].sort();
    const jpDates = [...jpCCMap.keys()].sort();

    let aligned = alignDates(usDates, jpDates);
    if (minDate) aligned = aligned.filter(a => a.jpDate >= minDate);

    const retUs = [];
    const retJp = [];
    const retJpOc = [];
    const dates = [];

    for (const { usDate, jpDate } of aligned) {
        const usRow = US_ETF_TICKERS.map(t => usMap.get(usDate)?.[t] ?? null);
        const jpRow = JP_ETF_TICKERS.map(t => jpCCMap.get(jpDate)?.[t] ?? null);
        const jpOcRow = JP_ETF_TICKERS.map(t => jpOCMap.get(jpDate)?.[t] ?? null);

        if (usRow.some(v => v === null || v === undefined) ||
            jpRow.some(v => v === null || v === undefined) ||
            jpOcRow.some(v => v === null || v === undefined)) continue;

        retUs.push({ date: usDate, values: usRow });
        retJp.push({ date: jpDate, values: jpRow });
        retJpOc.push({ date: jpDate, values: jpOcRow });
        dates.push(jpDate);
    }

    return { retUs, retJp, retJpOc, dates };
}

module.exports = { computeReturns, buildLeadLagMatrices };
