'use strict';

const YahooFinance = require('yahoo-finance2').default;

const BACKTEST_EXTRA_DAYS = 10;
const SIGNAL_MIN_DAYS = 280;
const SIGNAL_WINDOW_BUFFER = 160;

function toDisplayMetrics(raw, dayCount) {
  return {
    AR: raw.AR * 100,
    RISK: raw.RISK * 100,
    RR: raw.RR,
    MDD: raw.MDD * 100,
    Total: (raw.Cumulative - 1) * 100,
    Days: dayCount
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function buildJpBarLookupByTickerDate(jpData, tickers) {
  const lookup = {};
  for (const ticker of tickers) {
    const dateMap = new Map();
    const rows = Array.isArray(jpData[ticker]) ? jpData[ticker] : [];
    for (const row of rows) {
      if (row && row.date) {
        dateMap.set(row.date, row);
      }
    }
    lookup[ticker] = dateMap;
  }
  return lookup;
}

function topSignalIndex(signal) {
  let bestIdx = 0;
  let bestVal = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < signal.length; i++) {
    if (signal[i] > bestVal) {
      bestVal = signal[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

function computeOnePickTop1Backtest({
  retUs,
  retJp,
  retJpOc,
  signalConfig,
  signalGen,
  sectorLabels,
  CFull,
  jpData,
  jpTickers
}) {
  const windowLength = signalConfig.windowLength;
  const barsByTicker = buildJpBarLookupByTickerDate(jpData, jpTickers);

  let cumulativeProfitYen = 0;
  let cumulativeReturn = 1;
  let tradedDays = 0;
  let winDays = 0;
  let lossDays = 0;
  let flatDays = 0;
  let lastTrade = null;
  const tradeHistory = [];

  for (let i = windowLength; i < retJpOc.length; i++) {
    const start = i - windowLength;
    const retUsWin = retUs.slice(start, i).map((r) => r.values);
    const retJpWin = retJp.slice(start, i).map((r) => r.values);
    const retUsLatest = retUs[i - 1].values;
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, sectorLabels, CFull);
    const idx = topSignalIndex(signal);
    const ticker = jpTickers[idx];
    const date = retJpOc[i].date;
    const dailyReturn = retJpOc[i].values[idx];

    const bar = barsByTicker[ticker] ? barsByTicker[ticker].get(date) : null;
    let dailyProfitYen = dailyReturn;
    if (bar && Number.isFinite(bar.open) && Number.isFinite(bar.close) && bar.open > 0) {
      dailyProfitYen = bar.close - bar.open;
    }

    tradedDays += 1;
    cumulativeProfitYen += dailyProfitYen;
    cumulativeReturn *= (1 + dailyReturn);
    if (dailyProfitYen > 0) winDays += 1;
    else if (dailyProfitYen < 0) lossDays += 1;
    else flatDays += 1;
    lastTrade = {
      date,
      ticker,
      dailyProfitYen: round2(dailyProfitYen),
      dailyReturnPct: round2(dailyReturn * 100)
    };
    tradeHistory.push(lastTrade);
  }

  const last7Trades = tradeHistory.slice(-7);
  const last7ProfitYen = round2(last7Trades.reduce((sum, t) => sum + t.dailyProfitYen, 0));
  const last7WinDays = last7Trades.filter((t) => t.dailyProfitYen > 0).length;
  const last7LossDays = last7Trades.filter((t) => t.dailyProfitYen < 0).length;
  const last7FlatDays = last7Trades.length - last7WinDays - last7LossDays;
  const last7HitRatePct = last7Trades.length > 0 ? round2((last7WinDays / last7Trades.length) * 100) : 0;

  return {
    mode: 'one_share_top1_open_close',
    totalDays: Math.max(0, retJpOc.length - windowLength),
    tradedDays,
    totalProfitYen: round2(cumulativeProfitYen),
    cumulativeReturnPct: round2((cumulativeReturn - 1) * 100),
    averageDailyProfitYen: tradedDays > 0 ? round2(cumulativeProfitYen / tradedDays) : 0,
    hitRatePct: tradedDays > 0 ? round2((winDays / tradedDays) * 100) : 0,
    winDays,
    lossDays,
    flatDays,
    lastTrade,
    last7Days: {
      tradedDays: last7Trades.length,
      totalProfitYen: last7ProfitYen,
      hitRatePct: last7HitRatePct,
      winDays: last7WinDays,
      lossDays: last7LossDays,
      flatDays: last7FlatDays,
      trades: last7Trades
    }
  };
}

function computeDailyBuyCandidatesBacktest({
  retUs,
  retJp,
  retJpOc,
  signalConfig,
  signalGen,
  sectorLabels,
  CFull,
  jpData,
  jpTickers
}) {
  const windowLength = signalConfig.windowLength;
  const barsByTicker = buildJpBarLookupByTickerDate(jpData, jpTickers);
  const buyCount = Math.max(1, Math.floor(jpTickers.length * signalConfig.quantile));

  let cumulativeProfitYen = 0;
  let tradedDays = 0;
  let winDays = 0;
  let lossDays = 0;
  let flatDays = 0;
  const daily = [];

  for (let i = windowLength; i < retJpOc.length; i++) {
    const start = i - windowLength;
    const retUsWin = retUs.slice(start, i).map((r) => r.values);
    const retJpWin = retJp.slice(start, i).map((r) => r.values);
    const retUsLatest = retUs[i - 1].values;
    const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, sectorLabels, CFull);

    const ranked = signal.map((v, idx) => ({ v, idx })).sort((a, b) => b.v - a.v);
    const selected = ranked.slice(0, buyCount).map((x) => x.idx);
    const date = retJpOc[i].date;
    const picks = [];
    let dayProfitYen = 0;

    for (const idx of selected) {
      const ticker = jpTickers[idx];
      const bar = barsByTicker[ticker] ? barsByTicker[ticker].get(date) : null;
      const profit = bar && Number.isFinite(bar.open) && Number.isFinite(bar.close) && bar.open > 0
        ? (bar.close - bar.open)
        : 0;
      const rounded = round2(profit);
      dayProfitYen += rounded;
      picks.push({ ticker, dailyProfitYen: rounded });
    }

    dayProfitYen = round2(dayProfitYen);
    tradedDays += 1;
    cumulativeProfitYen = round2(cumulativeProfitYen + dayProfitYen);
    if (dayProfitYen > 0) winDays += 1;
    else if (dayProfitYen < 0) lossDays += 1;
    else flatDays += 1;

    daily.push({
      date,
      dayProfitYen,
      picks
    });
  }

  const last7 = daily.slice(-7);
  const last7ProfitYen = round2(last7.reduce((sum, d) => sum + d.dayProfitYen, 0));
  const last7Win = last7.filter((d) => d.dayProfitYen > 0).length;
  const last7Loss = last7.filter((d) => d.dayProfitYen < 0).length;
  const last7Flat = last7.length - last7Win - last7Loss;

  return {
    mode: 'daily_buy_candidates_each_1_share_sell_at_close',
    buyCount,
    totalDays: Math.max(0, retJpOc.length - windowLength),
    tradedDays,
    totalProfitYen: cumulativeProfitYen,
    averageDailyProfitYen: tradedDays > 0 ? round2(cumulativeProfitYen / tradedDays) : 0,
    hitRatePct: tradedDays > 0 ? round2((winDays / tradedDays) * 100) : 0,
    winDays,
    lossDays,
    flatDays,
    last7Days: {
      tradedDays: last7.length,
      totalProfitYen: last7ProfitYen,
      hitRatePct: last7.length > 0 ? round2((last7Win / last7.length) * 100) : 0,
      winDays: last7Win,
      lossDays: last7Loss,
      flatDays: last7Flat,
      days: last7
    }
  };
}

function createStrategyService(deps) {
  const {
    config,
    logger,
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
    buildPortfolio,
    applyTransactionCosts,
    computePerformanceMetrics,
    computeYearlyPerformance,
    computeRollingMetrics,
    summarizeSignalSourcePaths,
    buildOpsDecision,
    fetchWithRetry,
    writeAudit
  } = deps;

  async function runBacktest(body) {
    const validation = validateBacktestParams(body);
    if (validation.errors.length > 0) {
      return { status: 400, data: { error: 'Invalid parameters', details: validation.errors } };
    }

    const wl = validation.params.windowLength || config.backtest.windowLength;
    const backtestConfig = {
      windowLength: wl,
      nFactors: validation.params.nFactors || config.backtest.nFactors,
      lambdaReg: validation.params.lambdaReg !== undefined
        ? validation.params.lambdaReg
        : config.backtest.lambdaReg,
      quantile: validation.params.quantile || config.backtest.quantile,
      warmupPeriod: wl,
      orderedSectorKeys: config.pca.orderedSectorKeys
    };

    const costs = config.backtest.transactionCosts;
    const chartDays = config.backtest.chartCalendarDays;
    logger.info('Running backtest', { ...backtestConfig, chartCalendarDays: chartDays, costs });

    const needDays = backtestConfig.warmupPeriod + BACKTEST_EXTRA_DAYS;
    let [usRes, jpRes] = await Promise.all([
      fetchMarketDataForTickers(US_ETF_TICKERS, chartDays, config),
      fetchMarketDataForTickers(JP_ETF_TICKERS, chartDays, config)
    ]);
    let usData = usRes.byTicker;
    let jpData = jpRes.byTicker;

    let { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
      usData,
      jpData,
      US_ETF_TICKERS,
      JP_ETF_TICKERS,
      config.backtest.jpWindowReturn
    );

    let dataRecoveryAttempted = false;
    if (dates.length < needDays && !isCsvDataMode(config) && !isAlreadyFullYahooPath(config)) {
      dataRecoveryAttempted = true;
      const recoverCfg = configForYahooDataRecovery(config);
      [usRes, jpRes] = await Promise.all([
        fetchMarketDataForTickers(US_ETF_TICKERS, chartDays, recoverCfg),
        fetchMarketDataForTickers(JP_ETF_TICKERS, chartDays, recoverCfg)
      ]);
      usData = usRes.byTicker;
      jpData = jpRes.byTicker;
      ({ retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
        usData,
        jpData,
        US_ETF_TICKERS,
        JP_ETF_TICKERS,
        config.backtest.jpWindowReturn
      ));
    }

    if (dates.length < needDays) {
      const usErrN = Object.keys(usRes.errors || {}).length;
      const jpErrN = Object.keys(jpRes.errors || {}).length;
      const retrySuffix = dataRecoveryAttempted
        ? ' サーバー側で Yahoo 経路への自動切替・再取得を試みましたが、まだ不足しています。'
        : '';
      return {
        status: 200,
        data: {
          error: 'データが不足しています',
          detail:
            `揃った営業日が ${dates.length} 日（要 ${needDays} 日以上）。` +
            `チャート取得は ${chartDays} カレンダー日。米国/日本でエラー記録のある銘柄: ${usErrN} / ${jpErrN}。` +
            retrySuffix,
          metrics: { AR: 0, RISK: 0, RR: 0, MDD: 0, Total: 0, Days: dates.length },
          disclosure: riskPayload()
        }
      };
    }

    const combined = retUs.slice(0, Math.min(retUs.length, retJp.length))
      .map((r, i) => [...r.values, ...retJp[i].values]);
    const CFull = correlationMatrixSample(combined);
    const signalGen = new LeadLagSignal(backtestConfig);

    const results = [];
    const equalWeightSeries = [];
    const momentumSeries = [];
    let prevWeights = null;
    let prevMomWeights = null;
    for (let i = backtestConfig.warmupPeriod; i < retJpOc.length; i++) {
      const start = i - backtestConfig.windowLength;
      const retUsWin = retUs.slice(start, i).map(r => r.values);
      const retJpWin = retJp.slice(start, i).map(r => r.values);
      const retUsLatest = retUs[i].values;
      const signal = signalGen.computeSignal(retUsWin, retJpWin, retUsLatest, config.sectorLabels, CFull);
      const weights = buildPortfolio(signal, backtestConfig.quantile);
      const retNext = retJpOc[i].values;
      const nJp = retNext.length;

      let stratRet = 0;
      for (let j = 0; j < weights.length; j++) stratRet += weights[j] * retNext[j];
      stratRet = applyTransactionCosts(stratRet, costs, prevWeights, weights);
      prevWeights = weights;
      results.push({ date: retJpOc[i].date, return: stratRet });

      const eqRaw = retNext.reduce((s, x) => s + x, 0) / nJp;
      equalWeightSeries.push({ date: retJpOc[i].date, return: eqRaw });

      const mom = new Array(nJp).fill(0);
      for (let j = i - backtestConfig.windowLength; j < i; j++) {
        for (let k = 0; k < nJp; k++) mom[k] += retJp[j].values[k];
      }
      for (let k = 0; k < nJp; k++) mom[k] /= backtestConfig.windowLength;
      const wMom = buildPortfolio(mom, backtestConfig.quantile);
      let momRet = 0;
      for (let j = 0; j < nJp; j++) momRet += wMom[j] * retNext[j];
      momRet = applyTransactionCosts(momRet, costs, prevMomWeights, wMom);
      prevMomWeights = wMom;
      momentumSeries.push({ date: retJpOc[i].date, return: momRet });
    }

    const returns = results.map(r => r.return);
    const mStrat = computePerformanceMetrics(returns);
    const mEq = computePerformanceMetrics(equalWeightSeries.map(r => r.return));
    const mMom = computePerformanceMetrics(momentumSeries.map(r => r.return));

    const rollingWindow = config.backtest.rollingReportWindow;
    const rolling = computeRollingMetrics(results, rollingWindow);
    const rollingRR = rolling.map(x => x.RR);
    const rollingSummary = {
      window: rollingWindow,
      count: rolling.length,
      lastDate: rolling.length ? rolling[rolling.length - 1].date : null,
      lastRR: rolling.length ? rolling[rolling.length - 1].RR : null,
      minRR: rollingRR.length ? Math.min(...rollingRR) : null,
      maxRR: rollingRR.length ? Math.max(...rollingRR) : null,
      tail: rolling.slice(-5)
    };

    const yearlyRaw = computeYearlyPerformance(results);
    const yearlyStrategy = {};
    for (const [y, m] of Object.entries(yearlyRaw)) {
      const dayCount = results.filter(r => r.date.startsWith(y)).length;
      yearlyStrategy[y] = toDisplayMetrics(m, dayCount);
    }
    const stratDays = returns.length;

    return {
      status: 200,
      data: {
        config: {
          ...backtestConfig,
          transactionCosts: costs,
          chartCalendarDays: chartDays,
          rollingReportWindow: rollingWindow
        },
        ...(dataRecoveryAttempted
          ? {
            dataRecoveryNote:
                '初回の取得では営業日が足りなかったため、自動で Yahoo 経路に切り替えて再取得し、この結果を表示しています。'
          }
          : {}),
        costsNote:
          '取引コストはターンオーバーに比例（初日のみ全建て相当）。デフォルト 0＝論文の無摩擦。' +
          'JP 業種均等はコストなしの単純平均 OC（比較用）。',
        results: results.slice(-200),
        metrics: {
          ...toDisplayMetrics(mStrat, stratDays),
          costsApplied: true,
          equalWeightJP: toDisplayMetrics(mEq, equalWeightSeries.length),
          momentum: toDisplayMetrics(mMom, momentumSeries.length)
        },
        yearlyStrategy,
        rollingSummary,
        disclosure: riskPayload()
      }
    };
  }

  async function generateSignal(body) {
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

    const winDays = Math.max(SIGNAL_MIN_DAYS, signalConfig.windowLength + SIGNAL_WINDOW_BUFFER);
    let [usRes, jpRes] = await Promise.all([
      fetchMarketDataForTickers(US_ETF_TICKERS, winDays, config),
      fetchMarketDataForTickers(JP_ETF_TICKERS, winDays, config)
    ]);
    let usData = usRes.byTicker;
    let jpData = jpRes.byTicker;

    let { retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
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
      ({ retUs, retJp, retJpOc, dates } = buildReturnMatricesFromOhlcv(
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
          sourceSummary: summarizeSignalSourcePaths(usRes.sources, jpRes.sources, {
            jpDataMode: config.data.mode,
            usOhlcvProvider: config.data.usOhlcvProvider
          }),
          opsDecision: buildOpsDecision({
            usSources: usRes.sources,
            jpSources: jpRes.sources,
            usErrors: usRes.errors,
            jpErrors: jpRes.errors,
            signalDataRecoveryAttempted,
            insufficientData: true,
            jpDataMode: config.data.mode
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
    const onePickBacktest = computeOnePickTop1Backtest({
      retUs,
      retJp,
      retJpOc,
      signalConfig,
      signalGen,
      sectorLabels: config.sectorLabels,
      CFull,
      jpData,
      jpTickers: JP_ETF_TICKERS
    });
    const dailyBuyCandidatesBacktest = computeDailyBuyCandidatesBacktest({
      retUs,
      retJp,
      retJpOc,
      signalConfig,
      signalGen,
      sectorLabels: config.sectorLabels,
      CFull,
      jpData,
      jpTickers: JP_ETF_TICKERS
    });

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

    deps.runtimeState.lastSignal = {
      at: new Date().toISOString(),
      latestDate: dates[dates.length - 1],
      topTickers: signals.slice(0, 5).map((s) => s.ticker)
    };

    const buyCount = Math.max(1, Math.floor(JP_ETF_TICKERS.length * signalConfig.quantile));
    const buyCandidates = signals.slice(0, buyCount);
    const sellCandidates = signals.slice(-buyCount);
    const meanSig = signal.reduce((a, b) => a + b, 0) / signal.length;
    const stdSig = Math.sqrt(signal.reduce((sq, x) => sq + (x - meanSig) ** 2, 0) / signal.length);

    if (typeof writeAudit === 'function') {
      writeAudit('signal.api', {
        latestDate: dates[dates.length - 1],
        windowLength: signalConfig.windowLength,
        lambdaReg: signalConfig.lambdaReg,
        quantile: signalConfig.quantile,
        buyTickers: buyCandidates.map((s) => s.ticker),
        sellTickers: sellCandidates.map((s) => s.ticker)
      });
    }

    return {
      status: 200,
      data: {
        config: signalConfig,
        signals,
        buyCandidates,
        sellCandidates,
        latestDate: dates[dates.length - 1],
        metrics: { meanSignal: meanSig, stdSignal: stdSig },
        onePickBacktest,
        dailyBuyCandidatesBacktest,
        sourceSummary: summarizeSignalSourcePaths(usRes.sources, jpRes.sources, {
          jpDataMode: config.data.mode,
          usOhlcvProvider: config.data.usOhlcvProvider
        }),
        opsDecision: buildOpsDecision({
          usSources: usRes.sources,
          jpSources: jpRes.sources,
          usErrors: usRes.errors,
          jpErrors: jpRes.errors,
          signalDataRecoveryAttempted,
          insufficientData: false,
          jpDataMode: config.data.mode
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

  return {
    runBacktest,
    generateSignal
  };
}

module.exports = {
  createStrategyService,
  __internal: {
    buildJpBarLookupByTickerDate,
    topSignalIndex,
    computeOnePickTop1Backtest,
    computeDailyBuyCandidatesBacktest
  }
};

