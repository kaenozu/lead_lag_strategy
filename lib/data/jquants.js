/**
 * J-Quants API（JPX）日足 OHLCV
 * @see https://jpx.gitbook.io/j-quants-en/api-reference
 *
 * 認証:
 *   JQUANTS_REFRESH_TOKEN または JQUANTS_API_KEY（どちらも同じリフレッシュトークンを入れる）
 *   または JQUANTS_API_MAIL + JQUANTS_API_PASSWORD（その都度 refresh を取得）
 *
 *   JQUANTS_API_BASE（既定: https://api.jquants.com/v1）
 */

'use strict';

const { createLogger } = require('../logger');

const logger = createLogger('JQuants');

const DEFAULT_TIMEOUT_MS = 30000;
/** 413 回避のための 1 リクエストあたりの最大日数 */
const CHUNK_CALENDAR_DAYS = 120;

let warnedNoCredentials = false;

/** idToken キャッシュ（有効 ~24h） */
let idTokenCache = { token: '', base: '', refresh: '', expiresAt: 0 };

/**
 * アプリのティッカー → J-Quants の銘柄コード（4桁+0 等は銘柄ごとに要確認）
 */
function resolveJQuantsCode(ticker, appConfig) {
  const custom = appConfig?.data?.jquantsCodes && appConfig.data.jquantsCodes[ticker];
  if (custom) return String(custom);
  if (!ticker.endsWith('.T')) return null;
  const n = ticker.replace(/\.T$/i, '');
  if (!/^\d{4}$/.test(n)) return null;
  return `${n}0`;
}

/**
 * 日付キーで結合。同一日は後勝ち（直近 Yahoo 側を優先）
 */
function mergeOhlcvByDate(olderSegment, newerSegment) {
  const map = new Map();
  for (const row of olderSegment) {
    if (row && row.date && row.close > 0) {
      map.set(row.date, {
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume
      });
    }
  }
  for (const row of newerSegment) {
    if (row && row.date && row.close > 0) {
      map.set(row.date, {
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} fromStr - YYYY-MM-DD
 * @param {string} toStr - YYYY-MM-DD
 * @param {number} maxSpanDays - 区間長（暦日、両端含む）
 * @yields {{ from: string, to: string }}
 */
function* chunkDateRange(fromStr, toStr, maxSpanDays) {
  if (!fromStr || !toStr || fromStr > toStr) return;
  let cur = fromStr;
  while (cur <= toStr) {
    const end = addDaysIso(cur, maxSpanDays - 1);
    const toChunk = end > toStr ? toStr : end;
    yield { from: cur, to: toChunk };
    cur = addDaysIso(toChunk, 1);
  }
}

/**
 * @param {object} q - API daily_quotes 要素
 * @returns {{ date, open, high, low, close, volume } | null}
 */
function mapJQuantsDailyQuoteRow(q) {
  const date = String(q.Date || '').split('T')[0];
  const close = q.Close != null ? Number(q.Close) : NaN;
  if (!date || !Number.isFinite(close) || close <= 0) return null;
  const o = q.Open != null ? Number(q.Open) : close;
  const h = q.High != null ? Number(q.High) : close;
  const l = q.Low != null ? Number(q.Low) : close;
  const v = q.Volume != null ? Number(q.Volume) : 0;
  return { date, open: o, high: h, low: l, close, volume: v };
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init && init.headers) }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function apiBase(appConfig) {
  return String(appConfig?.data?.jquantsApiBase || 'https://api.jquants.com/v1').replace(
    /\/$/,
    ''
  );
}

function timeoutMs(appConfig) {
  const t = appConfig?.yahooFinance?.timeout;
  return Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
}

/**
 * リフレッシュトークン文字列を解決（メール経由なら auth_user）
 * @returns {Promise<{ refresh: string|null, error: string|null }>}
 */
async function resolveRefreshToken(appConfig) {
  const explicit =
    String(appConfig?.data?.jquantsRefreshToken || '').trim() ||
    String(appConfig?.data?.jquantsApiKey || '').trim();
  if (explicit) {
    return { refresh: explicit, error: null };
  }

  const mail = String(appConfig?.data?.jquantsMail || '').trim();
  const pass = String(appConfig?.data?.jquantsPassword || '').trim();
  if (!mail || !pass) {
    return { refresh: null, error: 'JQUANTS_NO_CREDENTIALS' };
  }

  const base = apiBase(appConfig);
  const { ok, status, json } = await fetchJson(`${base}/token/auth_user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailaddress: mail, password: pass }),
    signal: AbortSignal.timeout(timeoutMs(appConfig))
  });

  const rt = json && (json.refreshToken || json.RefreshToken);
  if (!ok || !rt) {
    logger.error('J-Quants auth_user に失敗しました', { status, message: json?.message });
    return { refresh: null, error: `JQUANTS_AUTH_USER_${status}` };
  }
  return { refresh: String(rt), error: null };
}

/**
 * @returns {Promise<{ idToken: string|null, error: string|null }>}
 */
async function getIdToken(appConfig, refresh) {
  const base = apiBase(appConfig);
  const now = Date.now();
  const skew = 120_000;
  if (
    idTokenCache.token &&
    idTokenCache.base === base &&
    idTokenCache.refresh === refresh &&
    now < idTokenCache.expiresAt - skew
  ) {
    return { idToken: idTokenCache.token, error: null };
  }

  const url = `${base}/token/auth_refresh?refreshtoken=${encodeURIComponent(refresh)}`;
  const { ok, status, json } = await fetchJson(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs(appConfig))
  });

  const idTok = json && (json.idToken || json.IdToken);
  if (!ok || !idTok) {
    idTokenCache = { token: '', base: '', refresh: '', expiresAt: 0 };
    logger.error('J-Quants auth_refresh に失敗しました', { status, message: json?.message });
    return { idToken: null, error: `JQUANTS_AUTH_REFRESH_${status}` };
  }

  idTokenCache = {
    token: String(idTok),
    base,
    refresh,
    expiresAt: now + 23 * 60 * 60 * 1000
  };
  return { idToken: idTokenCache.token, error: null };
}

function invalidateIdTokenCache() {
  idTokenCache = { token: '', base: '', refresh: '', expiresAt: 0 };
}

/**
 * 1 区間（from–to）の日足をページング取得
 * @returns {Promise<{ rows: Array|null, error: string|null, unauthorized?: boolean }>}
 */
async function fetchDailyQuotesOneWindow(base, idToken, code, from, to, appConfig) {
  const merged = [];
  let paginationKey = null;
  const t = timeoutMs(appConfig);

  for (;;) {
    const params = new URLSearchParams({ code, from, to });
    if (paginationKey) params.set('pagination_key', paginationKey);
    const url = `${base}/prices/daily_quotes?${params.toString()}`;
    const { ok, status, json } = await fetchJson(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
      signal: AbortSignal.timeout(t)
    });

    if (status === 401) {
      return { rows: null, error: 'JQUANTS_UNAUTHORIZED', unauthorized: true };
    }
    if (status === 413) {
      return { rows: null, error: 'JQUANTS_PAYLOAD_TOO_LARGE' };
    }
    if (!ok) {
      logger.warn(
        { status, message: json?.message, code, from, to },
        'J-Quants daily_quotes エラー'
      );
      return { rows: null, error: `JQUANTS_DAILY_${status}` };
    }

    const quotes = Array.isArray(json?.daily_quotes) ? json.daily_quotes : [];
    for (const q of quotes) {
      const row = mapJQuantsDailyQuoteRow(q);
      if (row) merged.push(row);
    }

    paginationKey = json?.pagination_key;
    if (!paginationKey || quotes.length === 0) break;
  }

  return { rows: merged, error: null };
}

/**
 * @param {string} ticker - 例 1617.T
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @param {object} appConfig - config 全体
 * @returns {Promise<{ data: Array, error: string|null }>}
 */
async function fetchJQuantsOhlcvRange(ticker, from, to, appConfig) {
  const code = resolveJQuantsCode(ticker, appConfig);
  if (!code) {
    return { data: [], error: 'NO_JQUANTS_CODE' };
  }

  const { refresh, error: credErr } = await resolveRefreshToken(appConfig);
  if (!refresh) {
    if (!warnedNoCredentials) {
      logger.warn(
        'J-Quants: 認証情報未設定のため履歴取得をスキップします（JQUANTS_REFRESH_TOKEN / JQUANTS_API_KEY または MAIL+PASSWORD）。Yahoo にフォールバックします。'
      );
      warnedNoCredentials = true;
    }
    return { data: [], error: credErr || 'JQUANTS_NO_CREDENTIALS' };
  }

  let idRes = await getIdToken(appConfig, refresh);
  if (idRes.error) {
    return { data: [], error: idRes.error };
  }
  let idToken = idRes.idToken;

  const base = apiBase(appConfig);
  const byDate = new Map();

  for (const { from: cf, to: ct } of chunkDateRange(from, to, CHUNK_CALENDAR_DAYS)) {
    let { rows, error, unauthorized } = await fetchDailyQuotesOneWindow(
      base,
      idToken,
      code,
      cf,
      ct,
      appConfig
    );

    if (unauthorized) {
      invalidateIdTokenCache();
      idRes = await getIdToken(appConfig, refresh);
      if (idRes.error) {
        return { data: [], error: idRes.error };
      }
      idToken = idRes.idToken;
      ({ rows, error, unauthorized } = await fetchDailyQuotesOneWindow(
        base,
        idToken,
        code,
        cf,
        ct,
        appConfig
      ));
    }

    if (error === 'JQUANTS_PAYLOAD_TOO_LARGE') {
      return { data: [], error: error };
    }
    if (error || !rows) {
      return { data: [], error: error || 'JQUANTS_DAILY_UNKNOWN' };
    }

    for (const r of rows) {
      byDate.set(r.date, r);
    }
  }

  const data = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { data, error: null };
}

module.exports = {
  resolveJQuantsCode,
  mergeOhlcvByDate,
  fetchJQuantsOhlcvRange,
  /** @internal unit tests */
  mapJQuantsDailyQuoteRow,
  chunkDateRange
};
