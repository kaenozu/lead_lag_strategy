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
    expect(s).toContain('米国: Stooq 0 / Yahoo直接 1 / AV 1 / AV→Yahoo 1 / CSV 0 / その他 0');
    expect(s).toContain(
      '日本: Stooq 0 / Yahoo直接 0 / JQ+Yahoo 1 / JQ失敗→Yahoo 1 / 短期Yahoo 1 / CSV 0 / その他 0'
    );

    const stooqMix = summarizeSignalSourcePaths(
      { XLB: 'us:stooq' },
      { '1617.T': 'jp:stooq', '1618.T': 'jp:stooq' }
    );
    expect(stooqMix).toContain('Stooq 1');
    expect(stooqMix).toContain('Stooq 2');
    expect(stooqMix).toContain('Stooq経由 3 銘柄');

    const stooqHint = summarizeSignalSourcePaths(
      { XLB: 'us:stooq' },
      { '1617.T': 'jp:stooq', '1618.T': 'jp:stooq' },
      { jpDataMode: 'stooq', usOhlcvProvider: 'stooq' }
    );
    expect(stooqHint).toContain('米国（設定: Stooq）: 1銘柄');
    expect(stooqHint).toContain('日本（設定: Stooq）: 2銘柄');

    const staleCache = summarizeSignalSourcePaths(
      { XLB: 'us:yahoo' },
      { '1617.T': 'jp:jquants_error->yahoo' },
      { jpDataMode: 'stooq', usOhlcvProvider: 'yahoo' }
    );
    expect(staleCache).toContain('日本（設定: Stooq）');
    expect(staleCache).toContain('想定外');
  });

  test('buildOpsDecision は不足データ時に SKIP', () => {
    const r = buildOpsDecision({ insufficientData: true });
    expect(r.level).toBe('SKIP');
    expect(r.reason).toMatch(/営業日数/);
  });

  test('buildOpsDecision は JQ 認証失敗時に SKIP（日本=jquants のとき）', () => {
    const r = buildOpsDecision({
      jpSources: { '1617.T': 'jp:jquants_error->yahoo' },
      jpErrors: { '1617.T': 'JQUANTS_AUTH_REFRESH_400' },
      jpDataMode: 'jquants'
    });
    expect(r.level).toBe('SKIP');
    expect(r.reason).toMatch(/J-Quants/);
  });

  test('buildOpsDecision は JQ 失敗→Yahoo のみ（認証エラーなし）では SKIP にしない', () => {
    const r = buildOpsDecision({
      jpSources: {
        '1617.T': 'jp:jquants_error->yahoo',
        '1618.T': 'jp:jquants+recent_yahoo'
      },
      jpDataMode: 'jquants'
    });
    expect(r.level).toBe('CAUTION');
    expect(r.reason).toMatch(/Yahoo で補完/);
  });

  test('buildOpsDecision は日本 yahoo のとき JQ 失敗タグだけでは SKIP にしない', () => {
    const r = buildOpsDecision({
      jpSources: { '1617.T': 'jp:jquants_error->yahoo' },
      jpErrors: { '1617.T': 'JQUANTS_AUTH_REFRESH_400' },
      jpDataMode: 'yahoo'
    });
    expect(r.level).toBe('CAUTION');
    expect(r.reason).toMatch(/保存設定は J-Quants 以外/);
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
