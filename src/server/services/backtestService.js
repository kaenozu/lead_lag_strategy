'use strict';

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

function createBacktestService(deps) {
  const {
    config,
    riskPayload,
    validateBacktestParams,
    fetchMarketDataForTickers,
    buildReturnMatricesFromOhlcv,
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
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
    dataMarginDays
  } = deps;

  async function run(body) {
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
    const needDays = backtestConfig.warmupPeriod + dataMarginDays;

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

  return { run };
}

module.exports = {
  createBacktestService
};

