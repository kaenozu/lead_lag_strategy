'use strict';

const { createBacktestService } = require('../../src/server/services/backtestService');

describe('backtestService', () => {
  test('returns 400 for invalid params and short-circuits', async () => {
    const fetchMarketDataForTickers = jest.fn();
    const service = createBacktestService({
      config: {
        backtest: {
          windowLength: 60,
          nFactors: 3,
          lambdaReg: 0.9,
          quantile: 0.4,
          transactionCosts: {},
          chartCalendarDays: 365,
          jpWindowReturn: 'cc',
          rollingReportWindow: 252
        },
        pca: { orderedSectorKeys: [] },
        sectorLabels: {}
      },
      riskPayload: jest.fn(() => ({ short: 'test', lines: [] })),
      validateBacktestParams: jest.fn(() => ({
        errors: ['windowLength must be between 10 and 500'],
        params: {}
      })),
      fetchMarketDataForTickers,
      buildReturnMatricesFromOhlcv: jest.fn(),
      US_ETF_TICKERS: [],
      JP_ETF_TICKERS: [],
      isCsvDataMode: jest.fn(),
      isAlreadyFullYahooPath: jest.fn(),
      configForYahooDataRecovery: jest.fn(),
      correlationMatrixSample: jest.fn(),
      LeadLagSignal: jest.fn(),
      buildPortfolio: jest.fn(),
      applyTransactionCosts: jest.fn(),
      computePerformanceMetrics: jest.fn(),
      computeYearlyPerformance: jest.fn(),
      computeRollingMetrics: jest.fn(),
      dataMarginDays: 10
    });

    const result = await service.run({ windowLength: 'bad' });
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('Invalid parameters');
    expect(result.data.details).toEqual(['windowLength must be between 10 and 500']);
    expect(fetchMarketDataForTickers).not.toHaveBeenCalled();
  });
});

