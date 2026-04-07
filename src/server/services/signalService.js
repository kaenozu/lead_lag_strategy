'use strict';

const YahooFinance = require('yahoo-finance2').default;

function createSignalService(deps) {
  const {
    config,
    riskPayload,
    validateBacktestParams,
    fetchMarketDataForTickers,
    buildReturnMatricesFromOhlcv,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    JP_ETF_NAMES,
    isCsvDataMode,
    isAlreadyFullYahooPath,
    configForYahooDataRecovery,
    correlationMatrixSample,
    LeadLagSignal,
    summarizeSignalSourcePaths,
    buildOpsDecision,
    fetchWithRetry,
    signalMinWindowDays
  } = deps;

  async function run(body) {
    const validation = validateBacktestParams(body);
    if (validation.errors.length > 0) {
      return { status: 400, data: { error: 'Invalid parameters', details: validation.errors } };
    }

    const signalConfig = {
      windowLength: validation.params.windowLength || config.backtest.windowLength,
      nFactors: validation.params.nFactors || config.backtest.nFactors,
      lambdaReg: validation.params.lambdaReg !== undefined
        ? validation.params.lambdaReg
        : config.backtest.lambdaReg,
      quantile: validation.params.quantile || config.backtest.quantile,
      orderedSectorKeys: config.pca.orderedSectorKeys
    };

    const winDays = Math.max(signalMinWindowDays, signalConfig.windowLength + 160);
    let [usRes, jpRes] = await Promise.all([
      fetchMarketDataForTickers(US_ETF_TICKERS, winDays, config),
      fetchMarketDataForTickers(JP_ETF_TICKERS, winDays, config)
    ]);
    let usData = usRes.byTicker;
    let jpData = jpRes.byTicker;

    let { retUs, retJp, dates } = buildReturnMatricesFromOhlcv(
      usData,
      jpData,
      US_ETF_TICKERS,
      JP_ETF_TICKERS,
      config.backtest.jpWindowReturn
    );

    let signalDataRecoveryAttempted = false;
    if (retUs.length < signalConfig.windowLength && !isCsvDataMode(config) && !isAlreadyFullYahooPath(config)) {
      signalDataRecoveryAttempted = true;
      const recoverCfg = configForYahooDataRecovery(config);
      [usRes, jpRes] = await Promise.all([
        fetchMarketDataForTickers(US_ETF_TICKERS, winDays, recoverCfg),
        fetchMarketDataForTickers(JP_ETF_TICKERS, winDays, recoverCfg)
      ]);
      usData = usRes.byTicker;
      jpData = jpRes.byTicker;
      ({ retUs, retJp, dates } = buildReturnMatricesFromOhlcv(
        usData,
        jpData,
        US_ETF_TICKERS,
        JP_ETF_TICKERS,
        config.backtest.jpWindowReturn
      ));
    }

    if (retUs.length < signalConfig.windowLength) {
      const usErrN = Object.keys(usRes.errors || {}).length;
      const jpErrN = Object.keys(jpRes.errors || {}).length;
      const usProv = String(config.data.usOhlcvProvider || '').toLowerCase();
      const retrySuffix = signalDataRecoveryAttempted
        ? ' サーバー側で Yahoo 経路への自動切替・再取得を試みましたが、まだ不足しています。'
        : '';
      const avHint =
        !signalDataRecoveryAttempted && usProv === 'alphavantage'
          ? ' 米国が Alpha Vantage（無料 compact は約100営業日）のときは窓が大きいと不足しやすいです。画面のデータソースで米国を Yahoo にするか、ウィンドウ長を下げてください。'
          : '';
      return {
        status: 200,
        data: {
          error: 'データが不足しています',
          detail:
            `揃った営業日が ${retUs.length} 日（要 ${signalConfig.windowLength} 日以上）。` +
            `取得窓は約 ${winDays} カレンダー日。米国/日本でエラー記録のある銘柄: ${usErrN} / ${jpErrN}。` +
            ' API 制限・休場・一部銘柄欠損で行が捨てられている可能性があります。' +
            retrySuffix +
            avHint,
          signals: [],
          sourceSummary: summarizeSignalSourcePaths(usRes.sources, jpRes.sources),
          opsDecision: buildOpsDecision({
            usSources: usRes.sources,
            jpSources: jpRes.sources,
            usErrors: usRes.errors,
            jpErrors: jpRes.errors,
            signalDataRecoveryAttempted,
            insufficientData: true
          }),
          disclosure: riskPayload()
        }
      };
    }

    const combined = retUs.map((r, i) => [...r.values, ...retJp[i].values]);
    const CFull = correlationMatrixSample(combined);
    const signalGen = new LeadLagSignal(signalConfig);
    const retUsWin = retUs.slice(-signalConfig.windowLength).map(r => r.values);
    const retJpWin = retJp.slice(-signalConfig.windowLength).map(r => r.values);
    const retUsLatest = retUs[retUs.length - 1].values;
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, config.sectorLabels, CFull);

    const signals = JP_ETF_TICKERS.map((ticker, i) => ({
      ticker,
      name: JP_ETF_NAMES[ticker] || ticker,
      signal: signal[i],
      rank: 0
    })).sort((a, b) => b.signal - a.signal);
    signals.forEach((s, i) => { s.rank = i + 1; });

    const yahooFinance = new YahooFinance();
    const quoteResults = await Promise.all(
      JP_ETF_TICKERS.map(async (ticker) => {
        try {
          const quote = await fetchWithRetry(
            () => yahooFinance.quote(ticker),
            { maxRetries: 2, baseDelay: 500 }
          );
          return [ticker, quote.regularMarketPrice || 0];
        } catch {
          return [ticker, 0];
        }
      })
    );
    const prices = Object.fromEntries(quoteResults);
    signals.forEach(s => {
      s.price = prices[s.ticker] || 0;
      s.priceFormatted = s.price > 0 ? `${s.price.toLocaleString()}円/口` : 'N/A';
    });

    const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * signalConfig.quantile));
    const buyCandidates = signals.slice(0, buyCount);
    const sellCandidates = signals.slice(-buyCount);
    const meanSig = signal.reduce((a, b) => a + b, 0) / signal.length;
    const stdSig = Math.sqrt(signal.reduce((sq, x) => sq + Math.pow(x - meanSig, 2), 0) / signal.length);

    return {
      status: 200,
      data: {
        config: signalConfig,
        signals,
        buyCandidates,
        sellCandidates,
        latestDate: dates[dates.length - 1],
        metrics: { meanSignal: meanSig, stdSignal: stdSig },
        sourceSummary: summarizeSignalSourcePaths(usRes.sources, jpRes.sources),
        opsDecision: buildOpsDecision({
          usSources: usRes.sources,
          jpSources: jpRes.sources,
          usErrors: usRes.errors,
          jpErrors: jpRes.errors,
          signalDataRecoveryAttempted,
          insufficientData: false
        }),
        ...(signalDataRecoveryAttempted
          ? {
            dataRecoveryNote:
                '初回の取得では営業日が足りなかったため、自動で Yahoo 経路に切り替えて再取得し、このシグナルを表示しています。'
          }
          : {}),
        disclosure: riskPayload()
      }
    };
  }

  return { run };
}

module.exports = {
  createSignalService
};

