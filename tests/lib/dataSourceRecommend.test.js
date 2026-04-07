'use strict';

const { computeRecommendedDataSource } = require('../../lib/config');

describe('computeRecommendedDataSource', () => {
  let origJp;
  let origUs;

  beforeEach(() => {
    origJp = process.env.OVERRIDE_JP_DATA_MODE;
    origUs = process.env.OVERRIDE_US_OHLCV_PROVIDER;
    delete process.env.OVERRIDE_JP_DATA_MODE;
    delete process.env.OVERRIDE_US_OHLCV_PROVIDER;
  });

  afterEach(() => {
    if (origJp === undefined) delete process.env.OVERRIDE_JP_DATA_MODE;
    else process.env.OVERRIDE_JP_DATA_MODE = origJp;
    if (origUs === undefined) delete process.env.OVERRIDE_US_OHLCV_PROVIDER;
    else process.env.OVERRIDE_US_OHLCV_PROVIDER = origUs;
  });

  test('上書きなし → 日本 Yahoo・米国 Yahoo（認証の有無に依存しない）', () => {
    const r = computeRecommendedDataSource({
      jquantsMail: '',
      jquantsPassword: '',
      jquantsRefreshToken: '',
      jquantsApiKey: '',
      alphaVantageApiKey: ''
    });
    expect(r.mode).toBe('yahoo');
    expect(r.usOhlcvProvider).toBe('yahoo');
    expect(r.reasonJp).toMatch(/Yahoo Finance/);
    expect(r.reasonUs).toMatch(/Yahoo Finance/);
  });

  test('J-Quants キーのみ → 既定は引き続き Yahoo・Yahoo（JQ は OVERRIDE で）', () => {
    const r = computeRecommendedDataSource({
      jquantsRefreshToken: 'tok',
      alphaVantageApiKey: ''
    });
    expect(r.mode).toBe('yahoo');
    expect(r.usOhlcvProvider).toBe('yahoo');
  });

  test('Alpha Vantage キーのみ → 既定は引き続き Yahoo・Yahoo（AV は OVERRIDE で）', () => {
    const r = computeRecommendedDataSource({
      jquantsMail: '',
      alphaVantageApiKey: 'DEMOKEY'
    });
    expect(r.mode).toBe('yahoo');
    expect(r.usOhlcvProvider).toBe('yahoo');
  });

  test('JQ + AV 両方 → 既定は引き続き Yahoo・Yahoo', () => {
    const r = computeRecommendedDataSource({
      jquantsApiKey: 'k',
      alphaVantageApiKey: 'av'
    });
    expect(r.mode).toBe('yahoo');
    expect(r.usOhlcvProvider).toBe('yahoo');
  });

  test('OVERRIDE_JP_DATA_MODE=jquants → jquants', () => {
    process.env.OVERRIDE_JP_DATA_MODE = 'jquants';
    const r = computeRecommendedDataSource({ alphaVantageApiKey: '' });
    expect(r.mode).toBe('jquants');
    expect(r.reasonJp).toMatch(/OVERRIDE_JP_DATA_MODE/);
  });

  test('OVERRIDE_US_OHLCV_PROVIDER=alphavantage → alphavantage', () => {
    process.env.OVERRIDE_US_OHLCV_PROVIDER = 'alphavantage';
    const r = computeRecommendedDataSource({});
    expect(r.usOhlcvProvider).toBe('alphavantage');
    expect(r.reasonUs).toMatch(/OVERRIDE_US_OHLCV_PROVIDER/);
  });
});
