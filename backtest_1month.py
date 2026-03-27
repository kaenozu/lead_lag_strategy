"""
日米業種リードラグ戦略 - 直近 1 ヶ月バックテスト
"""

import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
from subspace_pca import (
    SubspacePCAConfig,
    LeadLagSignal,
    build_portfolio,
    compute_performance_metrics,
    backtest
)
import warnings
warnings.filterwarnings('ignore')

# 米国セクター ETF
US_ETF_TICKERS = {
    'XLB': 'Materials',
    'XLC': 'Communication Services',
    'XLE': 'Energy',
    'XLF': 'Financials',
    'XLI': 'Industrials',
    'XLK': 'Information Technology',
    'XLP': 'Consumer Staples',
    'XLRE': 'Real Estate',
    'XLU': 'Utilities',
    'XLV': 'Health Care',
    'XLY': 'Consumer Discretionary',
}

# 日本セクター ETF
JP_ETF_TICKERS = {
    '1617.T': 'Food',
    '1618.T': 'Energy & Materials',
    '1619.T': 'Construction & Materials',
    '1620.T': 'Materials & Chemicals',
    '1621.T': 'Pharmaceuticals',
    '1622.T': 'Automobiles & Parts',
    '1623.T': 'Steel & Nonferrous Metals',
    '1624.T': 'Machinery',
    '1625.T': 'Electronics & Precision Instruments',
    '1626.T': 'IT & Services',
    '1627.T': 'Electric Power & Gas',
    '1628.T': 'Transportation & Logistics',
    '1629.T': 'Wholesale Trade',
    '1630.T': 'Retail Trade',
    '1631.T': 'Banks',
    '1632.T': 'Securities & Commodities',
    '1633.T': 'Insurance',
}

SECTOR_LABELS = {
    'US_XLB': 'cyclical',
    'US_XLE': 'cyclical',
    'US_XLF': 'cyclical',
    'US_XLRE': 'cyclical',
    'US_XLK': 'defensive',
    'US_XLP': 'defensive',
    'US_XLU': 'defensive',
    'US_XLV': 'defensive',
    'US_XLI': 'neutral',
    'US_XLC': 'neutral',
    'US_XLY': 'neutral',
    'JP_1618.T': 'cyclical',
    'JP_1625.T': 'cyclical',
    'JP_1629.T': 'cyclical',
    'JP_1631.T': 'cyclical',
    'JP_1617.T': 'defensive',
    'JP_1621.T': 'defensive',
    'JP_1627.T': 'defensive',
    'JP_1630.T': 'defensive',
    'JP_1619.T': 'neutral',
    'JP_1620.T': 'neutral',
    'JP_1622.T': 'neutral',
    'JP_1623.T': 'neutral',
    'JP_1624.T': 'neutral',
    'JP_1626.T': 'neutral',
    'JP_1628.T': 'neutral',
    'JP_1632.T': 'neutral',
    'JP_1633.T': 'neutral',
}


def paper_align_us_jp(returns_us, returns_jp, returns_jp_oc):
    rows_us = []
    rows_jp = []
    rows_oc = []
    idx_out = []
    for jp_d in returns_jp.index.sort_values():
        us_before = returns_us.index[returns_us.index < jp_d]
        if len(us_before) == 0:
            continue
        us_d = us_before.sort_values()[-1]
        try:
            u = returns_us.loc[us_d]
            j = returns_jp.loc[jp_d]
            jo = returns_jp_oc.loc[jp_d]
        except (KeyError, TypeError):
            continue
        if u.isna().any() or j.isna().any() or jo.isna().any():
            continue
        rows_us.append(u)
        rows_jp.append(j)
        rows_oc.append(jo)
        idx_out.append(jp_d)
    return (
        pd.DataFrame(rows_us, index=idx_out),
        pd.DataFrame(rows_jp, index=idx_out),
        pd.DataFrame(rows_oc, index=idx_out),
    )


def download_data(start_date, end_date):
    print(f"データ取得中：{start_date} ~ {end_date}")
    
    # 米国 ETF
    us_data = {}
    for ticker in US_ETF_TICKERS.keys():
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if len(df) > 0:
                us_data[f'US_{ticker}'] = df
        except Exception as e:
            print(f"Warning: {ticker} の取得に失敗：{e}")

    # 日本 ETF
    jp_data = {}
    for ticker in JP_ETF_TICKERS.keys():
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if len(df) > 0:
                jp_data[f'JP_{ticker}'] = df
        except Exception as e:
            print(f"Warning: {ticker} の取得に失敗：{e}")

    if len(us_data) == 0 or len(jp_data) == 0:
        raise ValueError("データの取得に失敗しました")

    # Close-to-Close リターン
    def compute_cc_returns(data_dict):
        returns = {}
        for name, df in data_dict.items():
            close = df['Close'].dropna()
            ret = close.pct_change().dropna()
            returns[name] = ret
        return pd.DataFrame(returns)

    returns_us = compute_cc_returns(us_data)
    returns_jp = compute_cc_returns(jp_data)

    # 日本 Open-to-Close リターン
    returns_jp_oc = {}
    for name, df in jp_data.items():
        open_p = df['Open'].dropna()
        close = df['Close'].dropna()
        ret_oc = (close / open_p) - 1
        ret_oc = ret_oc.reindex(returns_jp.index)
        returns_jp_oc[name] = ret_oc
    returns_jp_oc = pd.DataFrame(returns_jp_oc)

    returns_us = returns_us.ffill().bfill()
    returns_jp = returns_jp.ffill().bfill()
    returns_jp_oc = returns_jp_oc.ffill().bfill()

    returns_us, returns_jp, returns_jp_oc = paper_align_us_jp(
        returns_us, returns_jp, returns_jp_oc
    )

    return returns_us, returns_jp, returns_jp_oc


def compute_C_full(returns_us, returns_jp, start_date='2010-01-01', end_date='2014-12-31'):
    mask = (returns_us.index >= start_date) & (returns_us.index <= end_date)
    ret_us = returns_us.loc[mask]
    ret_jp = returns_jp.loc[mask]
    ret_combined = pd.concat([ret_us, ret_jp], axis=1)
    C_full = ret_combined.corr().values
    return C_full


def run_1month_backtest():
    print("=" * 60)
    print("日米業種リードラグ戦略 - 直近 1 ヶ月バックテスト")
    print("=" * 60)
    
    # 日付設定
    today = datetime.now()
    end_date = today.strftime('%Y-%m-%d')
    start_date = (today - timedelta(days=90)).strftime('%Y-%m-%d')  # 3 ヶ月前から取得
    train_start = '2010-01-01'
    train_end = '2014-12-31'
    
    # データ取得
    returns_us, returns_jp, returns_jp_oc = download_data(start_date, end_date)
    
    if len(returns_jp) < 65:
        print(f"エラー：データが不足しています（必要：65 日、実際：{len(returns_jp)}日）")
        return None
    
    # 長期相関行列
    print("\n長期相関行列 C_full の計算中...")
    returns_us_full, returns_jp_full = download_data(train_start, train_end)
    C_full = compute_C_full(returns_us_full, returns_jp_full)
    
    # 設定
    config = SubspacePCAConfig(
        window_length=60,
        n_factors=3,
        lambda_reg=0.9,
        quantile=0.4
    )
    
    # バックテスト実行
    print("\nバックテスト実行中...")
    results_sub = backtest(
        returns_us, returns_jp, returns_jp_oc,
        config, SECTOR_LABELS, C_full
    )
    
    if len(results_sub) == 0:
        print("エラー：バックテスト結果がありません")
        return None
    
    metrics = compute_performance_metrics(results_sub['return'].values)
    
    # 結果表示
    print("\n" + "=" * 60)
    print(f"期間：{results_sub.index[0]} ~ {results_sub.index[-1]}")
    print(f"取引日数：{len(results_sub)}日")
    print("=" * 60)
    print(f"月率リターン：{metrics['AR']*100:.2f}%")
    print(f"月率リスク：{metrics['RISK']*100:.2f}%")
    print(f"リスク・リターン比：{metrics['R/R']:.2f}")
    print(f"最大ドローダウン：{metrics['MDD']*100:.2f}%")
    print(f"勝率：{metrics['Win Rate']*100:.1f}%")
    print("=" * 60)
    
    # 日次リターン詳細
    print("\n【日次リターン詳細】")
    results_sub['cumulative'] = (1 + results_sub['return']).cumprod() - 1
    print(results_sub[['return']].to_string(float_format=lambda x: f'{x*100:.2f}%'))
    
    # 損益日数
    profitable_days = (results_sub['return'] > 0).sum()
    loss_days = (results_sub['return'] < 0).sum()
    print(f"\n収益日数：{profitable_days}日")
    print(f"損失日数：{loss_days}日")
    
    # 最大収益日・最大損失日
    best_day = results_sub['return'].max()
    worst_day = results_sub['return'].min()
    best_date = results_sub['return'].idxmax()
    worst_date = results_sub['return'].idxmin()
    print(f"\n最大収益日：{best_date.strftime('%Y-%m-%d')} ({best_day*100:.2f}%)")
    print(f"最大損失日：{worst_date.strftime('%Y-%m-%d')} ({worst_day*100:.2f}%)")
    
    return results_sub


if __name__ == '__main__':
    results = run_1month_backtest()
