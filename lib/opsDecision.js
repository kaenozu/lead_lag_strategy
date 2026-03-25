'use strict';

/**
 * @param {Record<string, string>} usSources
 * @param {Record<string, string>} jpSources
 */
function collectPathCounts(usSources = {}, jpSources = {}) {
  const usVals = Object.values(usSources);
  const jpVals = Object.values(jpSources);
  return {
    usVals,
    jpVals,
    usAv: usVals.filter((v) => v === 'us:alphavantage').length,
    usAvY: usVals.filter((v) => v === 'us:alphavantage->yahoo').length,
    usYahoo: usVals.filter((v) => v === 'us:yahoo').length,
    usCsv: usVals.filter((v) => String(v).includes('csv')).length,
    usStooq: usVals.filter((v) => String(v).includes('stooq')).length,
    jpMix: jpVals.filter((v) => v === 'jp:jquants+recent_yahoo').length,
    jpErrY: jpVals.filter((v) => v === 'jp:jquants_error->yahoo').length,
    jpShortY: jpVals.filter((v) => v === 'jp:yahoo_short_window').length,
    jpYahoo: jpVals.filter((v) => v === 'jp:yahoo').length,
    jpCsv: jpVals.filter((v) => String(v).includes('csv')).length,
    jpStooq: jpVals.filter((v) => String(v).includes('stooq')).length
  };
}

function usOtherCount(c) {
  const known = c.usAv + c.usAvY + c.usYahoo + c.usCsv + c.usStooq;
  return Math.max(0, c.usVals.length - known);
}

function jpOtherCount(c) {
  const known = c.jpMix + c.jpErrY + c.jpShortY + c.jpYahoo + c.jpCsv + c.jpStooq;
  return Math.max(0, c.jpVals.length - known);
}

/**
 * 米国側の表示（画面保存の usOhlcvProvider に合わせて簡潔化）
 * @param {ReturnType<typeof collectPathCounts>} c
 * @param {string} usProv
 */
function formatUsLine(c, usProv) {
  const p = String(usProv || '').toLowerCase();
  if (p === 'stooq') {
    const unexpected = c.usVals.filter(
      (v) => !String(v).includes('stooq') && !String(v).includes('csv')
    ).length;
    if (unexpected === 0) {
      return `米国（設定: Stooq）: ${c.usStooq}銘柄`;
    }
    return `米国（設定: Stooq）: Stooq系 ${c.usStooq} / CSV ${c.usCsv} / 想定外 ${unexpected}（設定と取得タグが一致していません。シグナル再取得またはサーバー再起動を試してください）`;
  }
  if (p === 'yahoo') {
    const unexpected = c.usVals.filter((v) => {
      const s = String(v);
      return s !== 'us:yahoo' && !s.includes('csv');
    }).length;
    if (unexpected === 0) {
      return `米国（設定: Yahoo）: Yahoo直接 ${c.usYahoo}銘柄`;
    }
    return `米国（設定: Yahoo）: Yahoo ${c.usYahoo} / CSV ${c.usCsv} / 想定外 ${unexpected}`;
  }
  const other = usOtherCount(c);
  return `米国: Stooq ${c.usStooq} / Yahoo直接 ${c.usYahoo} / AV ${c.usAv} / AV→Yahoo ${c.usAvY} / CSV ${c.usCsv} / その他 ${other}`;
}

/**
 * 日本側の表示（画面保存の data.mode に合わせて簡潔化）
 * @param {ReturnType<typeof collectPathCounts>} c
 * @param {string} jpMode
 */
function formatJpLine(c, jpMode) {
  const m = String(jpMode || '').toLowerCase();
  if (m === 'stooq') {
    const unexpected = c.jpVals.filter(
      (v) => !String(v).includes('stooq') && !String(v).includes('csv')
    ).length;
    if (unexpected === 0) {
      return `日本（設定: Stooq）: ${c.jpStooq}銘柄`;
    }
    return `日本（設定: Stooq）: Stooq系 ${c.jpStooq} / CSV ${c.jpCsv} / 想定外 ${unexpected}（古いキャッシュの可能性: 「シグナル生成」を押して取り直してください）`;
  }
  if (m === 'yahoo') {
    const unexpected = c.jpVals.filter((v) => {
      const s = String(v);
      return s !== 'jp:yahoo' && s !== 'jp:yahoo_short_window' && !s.includes('csv');
    }).length;
    if (unexpected === 0) {
      return `日本（設定: Yahoo）: Yahoo直接 ${c.jpYahoo} / 短期窓 ${c.jpShortY}`;
    }
    return `日本（設定: Yahoo）: Yahoo直接 ${c.jpYahoo} / 短期窓 ${c.jpShortY} / CSV ${c.jpCsv} / 想定外 ${unexpected}`;
  }
  if (m === 'csv') {
    const unexpected = c.jpVals.filter((v) => !String(v).includes('csv')).length;
    if (unexpected === 0) {
      return `日本（設定: CSV）: ${c.jpCsv}銘柄`;
    }
    return `日本（設定: CSV）: CSV ${c.jpCsv} / 想定外 ${unexpected}`;
  }
  const other = jpOtherCount(c);
  return `日本: Stooq ${c.jpStooq} / Yahoo直接 ${c.jpYahoo} / JQ+Yahoo ${c.jpMix} / JQ失敗→Yahoo ${c.jpErrY} / 短期Yahoo ${c.jpShortY} / CSV ${c.jpCsv} / その他 ${other}`;
}

/**
 * @param {Record<string, string>} usSources
 * @param {Record<string, string>} jpSources
 * @param {{ jpDataMode?: string, usOhlcvProvider?: string }} [hint] — サーバー lib/config の保存値（未指定時は従来の詳細表記のみ）
 */
function summarizeSignalSourcePaths(usSources = {}, jpSources = {}, hint = {}) {
  const c = collectPathCounts(usSources, jpSources);
  const jpMode = hint.jpDataMode;
  const usProv = hint.usOhlcvProvider;

  const hasHint =
    String(jpMode || '').trim() !== '' || String(usProv || '').trim() !== '';

  if (!hasHint) {
    const usPart = formatUsLine(c, 'alphavantage');
    const jpPart = formatJpLine(c, 'jquants');
    const stooqTotal = c.jpStooq + c.usStooq;
    const stooqNote =
      stooqTotal > 0
        ? ` ［Stooq経由 ${stooqTotal} 銘柄（日本${c.jpStooq}・米国${c.usStooq}）stooq.com 日足］`
        : '';
    return `${usPart} | ${jpPart}${stooqNote}`;
  }

  const usLine = formatUsLine(c, usProv || 'alphavantage');
  const jpLine = formatJpLine(c, jpMode || 'jquants');
  return `${usLine} | ${jpLine}`;
}

function buildOpsDecision({
  usSources = {},
  jpSources = {},
  usErrors = {},
  jpErrors = {},
  signalDataRecoveryAttempted = false,
  insufficientData = false,
  /** 未指定時は従来互換で J-Quants 前提（厳しめ） */
  jpDataMode
} = {}) {
  const usVals = Object.values(usSources);
  const jpVals = Object.values(jpSources);
  const usAvYahoo = usVals.filter((v) => v === 'us:alphavantage->yahoo').length;
  const jpJqErrYahoo = jpVals.filter((v) => v === 'jp:jquants_error->yahoo').length;
  const jpShortYahoo = jpVals.filter((v) => v === 'jp:yahoo_short_window').length;
  const jqAuthErrorCount = Object.values(jpErrors).filter((e) =>
    typeof e === 'string' && e.startsWith('JQUANTS_AUTH_')
  ).length;

  const jpModeRaw =
    jpDataMode === undefined || jpDataMode === null || String(jpDataMode).trim() === ''
      ? 'jquants'
      : String(jpDataMode).toLowerCase();
  /** 日本が jquants のときだけ「JQ 失敗→Yahoo」「JQ 認証エラー」を見送り理由に使う */
  const jquantsStrict = jpModeRaw === 'jquants';

  const checks = {
    insufficientData,
    signalDataRecoveryAttempted,
    jqAuthErrorCount,
    usAvYahooCount: usAvYahoo,
    jpJqErrYahooCount: jpJqErrYahoo,
    jpShortYahooCount: jpShortYahoo,
    usErrorCount: Object.keys(usErrors || {}).length,
    jpErrorCount: Object.keys(jpErrors || {}).length,
    jpDataMode: jpModeRaw
  };

  if (insufficientData) {
    return {
      level: 'SKIP',
      reason:
        '必要な営業日数が揃っていません。ウィンドウ長を下げるか、米国を Yahoo にする・Alpha Vantage の窓（compact）を確認するなど、データソースを見直してください。',
      checks
    };
  }

  /** 認証が壊れているときだけ見送り。JQ 失敗→Yahoo のみ（認証OK）は補完として CAUTION */
  if (jquantsStrict && jqAuthErrorCount > 0) {
    const parts = [];
    parts.push(`J-Quants 認証エラー ${jqAuthErrorCount} 件（.env のトークン・キーを確認）`);
    if (jpJqErrYahoo > 0) {
      parts.push(`併せて J-Quants で取れず Yahoo に落ちた銘柄 ${jpJqErrYahoo}`);
    }
    return {
      level: 'SKIP',
      reason:
        `${parts.join('。')}。本日は見送り推奨です。認証を修正するか、一時的に OVERRIDE_JP_DATA_MODE=yahoo / stooq で再取得してください。`,
      checks
    };
  }

  if (
    usAvYahoo > 0 ||
    jpShortYahoo > 0 ||
    signalDataRecoveryAttempted ||
    (jquantsStrict && jpJqErrYahoo > 0)
  ) {
    const onlyJqFallback =
      jquantsStrict &&
      jpJqErrYahoo > 0 &&
      usAvYahoo === 0 &&
      jpShortYahoo === 0 &&
      !signalDataRecoveryAttempted;
    const reason = onlyJqFallback
      ? `J-Quants で取得できなかった銘柄 ${jpJqErrYahoo} 件は Yahoo で補完しています（シグナルは計算済み）。` +
        '銘柄コード・API 制限を確認するか、問題が続く場合は OVERRIDE_JP_DATA_MODE=yahoo で統一できます。注意して判断してください。'
      : '一部フォールバックがあるため注意して判断してください。';
    return {
      level: 'CAUTION',
      reason,
      checks
    };
  }

  if (!jquantsStrict && (jqAuthErrorCount > 0 || jpJqErrYahoo > 0)) {
    return {
      level: 'CAUTION',
      reason:
        '日本の保存設定は J-Quants 以外ですが、取得タグに J-Quants 由来の痕跡があります。データ取得で「おすすめを適用」または保存後、「シグナル生成」で取り直してください。',
      checks
    };
  }

  return {
    level: 'GO',
    reason: 'データ状態は概ね良好です。',
    checks
  };
}

module.exports = {
  summarizeSignalSourcePaths,
  buildOpsDecision
};
