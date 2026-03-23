'use strict';

function summarizeSignalSourcePaths(usSources = {}, jpSources = {}) {
  const usVals = Object.values(usSources);
  const jpVals = Object.values(jpSources);
  const usAv = usVals.filter((v) => v === 'us:alphavantage').length;
  const usAvY = usVals.filter((v) => v === 'us:alphavantage->yahoo').length;
  const jpMix = jpVals.filter((v) => v === 'jp:jquants+recent_yahoo').length;
  const jpErrY = jpVals.filter((v) => v === 'jp:jquants_error->yahoo').length;
  const jpShortY = jpVals.filter((v) => v === 'jp:yahoo_short_window').length;

  const usPart = `米国: AV ${usAv} / AV→Yahoo ${usAvY} / その他 ${Math.max(0, usVals.length - usAv - usAvY)}`;
  const jpPart = `日本: JQ+Yahoo ${jpMix} / JQ失敗→Yahoo ${jpErrY} / 短期Yahoo ${jpShortY}`;
  return `${usPart} | ${jpPart}`;
}

function buildOpsDecision({
  usSources = {},
  jpSources = {},
  usErrors = {},
  jpErrors = {},
  signalDataRecoveryAttempted = false,
  insufficientData = false
}) {
  const usVals = Object.values(usSources);
  const jpVals = Object.values(jpSources);
  const usAvYahoo = usVals.filter((v) => v === 'us:alphavantage->yahoo').length;
  const jpJqErrYahoo = jpVals.filter((v) => v === 'jp:jquants_error->yahoo').length;
  const jpShortYahoo = jpVals.filter((v) => v === 'jp:yahoo_short_window').length;
  const jqAuthErrorCount = Object.values(jpErrors).filter((e) =>
    typeof e === 'string' && e.startsWith('JQUANTS_AUTH_')
  ).length;

  const checks = {
    insufficientData,
    signalDataRecoveryAttempted,
    jqAuthErrorCount,
    usAvYahooCount: usAvYahoo,
    jpJqErrYahooCount: jpJqErrYahoo,
    jpShortYahooCount: jpShortYahoo,
    usErrorCount: Object.keys(usErrors || {}).length,
    jpErrorCount: Object.keys(jpErrors || {}).length
  };

  if (insufficientData || jqAuthErrorCount > 0 || jpJqErrYahoo > 0) {
    return {
      level: 'SKIP',
      reason: 'データ品質に問題があるため本日は見送り推奨です。',
      checks
    };
  }

  if (usAvYahoo > 0 || jpShortYahoo > 0 || signalDataRecoveryAttempted) {
    return {
      level: 'CAUTION',
      reason: '一部フォールバックがあるため注意して判断してください。',
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
