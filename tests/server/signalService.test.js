'use strict';

const { createSignalService } = require('../../src/server/services/signalService');

describe('signalService', () => {
  test('returns 400 for invalid params from validator', async () => {
    const svc = createSignalService({
      config: {},
      riskPayload: jest.fn(() => ({ short: 'x', lines: [] })),
      validateBacktestParams: jest.fn(() => ({
        errors: ['windowLength must be between 10 and 500'],
        params: {}
      })),
      fetchMarketDataForTickers: jest.fn(),
      buildReturnMatricesFromOhlcv: jest.fn(),
      US_ETF_TICKERS: [],
      JP_ETF_TICKERS: [],
      JP_ETF_NAMES: {},
      isCsvDataMode: jest.fn(),
      isAlreadyFullYahooPath: jest.fn(),
      configForYahooDataRecovery: jest.fn(),
      correlationMatrixSample: jest.fn(),
      LeadLagSignal: jest.fn(),
      summarizeSignalSourcePaths: jest.fn(),
      buildOpsDecision: jest.fn(),
      fetchWithRetry: jest.fn(),
      signalMinWindowDays: 280
    });

    const result = await svc.run({ windowLength: 'abc' });
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('Invalid parameters');
    expect(result.data.details).toEqual(
      expect.arrayContaining(['windowLength must be between 10 and 500'])
    );
  });
});

