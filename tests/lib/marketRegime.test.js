'use strict';

const { determineMarketRegime, MarketRegime } = require('../../lib/marketRegime');

describe('lib/marketRegime', () => {
  test('短い価格系列でも利用可能範囲で判定情報を返す', () => {
    const shortPrices = [100, 102, 103];

    const result = determineMarketRegime(shortPrices, {
      lookback: 200,
      bullThreshold: 1.05,
      bearThreshold: 0.95,
      positionSizeBull: 1.0,
      positionSizeBear: 0.0,
      positionSizeNeutral: 0.5
    });

    expect(result.regime).toBe(MarketRegime.NEUTRAL);
    expect(result.price).toBe(103);
    expect(result.ma).toBeGreaterThan(0);
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.message).not.toBe('データ不足');
  });
});
