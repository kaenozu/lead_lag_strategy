'use strict';

const { summarizeSignalSourcePaths, buildOpsDecision } = require('../../lib/opsDecision');

describe('lib/opsDecision', () => {
  test('summarizeSignalSourcePaths は経路件数を返す', () => {
    const s = summarizeSignalSourcePaths(
      {
        XLB: 'us:alphavantage',
        XLC: 'us:alphavantage->yahoo',
        XLE: 'us:yahoo'
      },
      {
        '1617.T': 'jp:jquants+recent_yahoo',
        '1618.T': 'jp:jquants_error->yahoo',
        '1619.T': 'jp:yahoo_short_window'
      }
    );
    expect(s).toContain('米国: AV 1 / AV→Yahoo 1 / その他 1');
    expect(s).toContain('日本: JQ+Yahoo 1 / JQ失敗→Yahoo 1 / 短期Yahoo 1');
  });

  test('buildOpsDecision は不足データ時に SKIP', () => {
    const r = buildOpsDecision({ insufficientData: true });
    expect(r.level).toBe('SKIP');
  });

  test('buildOpsDecision は JQ 認証失敗時に SKIP', () => {
    const r = buildOpsDecision({
      jpSources: { '1617.T': 'jp:jquants_error->yahoo' },
      jpErrors: { '1617.T': 'JQUANTS_AUTH_REFRESH_400' }
    });
    expect(r.level).toBe('SKIP');
  });

  test('buildOpsDecision は AV フォールバック時に CAUTION', () => {
    const r = buildOpsDecision({
      usSources: { XLB: 'us:alphavantage->yahoo' }
    });
    expect(r.level).toBe('CAUTION');
  });

  test('buildOpsDecision は正常系で GO', () => {
    const r = buildOpsDecision({
      usSources: { XLB: 'us:alphavantage' },
      jpSources: { '1617.T': 'jp:jquants+recent_yahoo' }
    });
    expect(r.level).toBe('GO');
  });
});
