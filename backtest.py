"""
日米業種リードラグ戦略のバックテスト
Backtest for Japanese-U.S. Sector Lead-Lag Strategy
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


# ============================================================================
# データ設定
# ============================================================================

# 米国セクター ETF (Select Sector SPDR)
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

# 日本セクター ETF (TOPIX-17 業種別)
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

# セクターラベル（シクリカル/ディフェンシブ）
SECTOR_LABELS = {
    # 米国
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
    # 日本
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


def download_data(
    start_date: str = '2015-01-01',
    end_date: str = '2025-12-31'
) -> tuple:
    """
    ETF データのダウンロード
    
    Returns
    -------
    returns_us : pd.DataFrame
        米国 Close-to-Close リターン
    returns_jp : pd.DataFrame
        日本 Close-to-Close リターン
    returns_jp_oc : pd.DataFrame
        日本 Open-to-Close リターン
    """
    print("データダウンロード中...")
    
    # 米国 ETF
    us_data = {}
    for ticker in US_ETF_TICKERS.keys():
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if len(df) > 0:
                us_data[f'US_{ticker}'] = df
        except Exception as e:
            print(f"Warning: {ticker} の取得に失敗: {e}")
    
    # 日本 ETF
    jp_data = {}
    for ticker in JP_ETF_TICKERS.keys():
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if len(df) > 0:
                jp_data[f'JP_{ticker}'] = df
        except Exception as e:
            print(f"Warning: {ticker} の取得に失敗: {e}")
    
    if len(us_data) == 0 or len(jp_data) == 0:
        raise ValueError("データの取得に失敗しました")
    
    # Close-to-Close リターンの計算
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
    
    # 共通の取引日に揃える
    common_dates = returns_us.index.intersection(returns_jp.index)
    common_dates = common_dates.intersection(returns_jp_oc.index)
    
    returns_us = returns_us.loc[common_dates]
    returns_jp = returns_jp.loc[common_dates]
    returns_jp_oc = returns_jp_oc.loc[common_dates]
    
    # 欠損値の処理（前方充填）
    returns_us = returns_us.ffill().bfill()
    returns_jp = returns_jp.ffill().bfill()
    returns_jp_oc = returns_jp_oc.ffill().bfill()
    
    print(f"データ期間：{common_dates[0]} ~ {common_dates[-1]}")
    print(f"米国セクター数：{returns_us.shape[1]}")
    print(f"日本セクター数：{returns_jp.shape[1]}")
    print(f"総取引日数：{len(common_dates)}")
    
    return returns_us, returns_jp, returns_jp_oc


def compute_C_full(
    returns_us: pd.DataFrame,
    returns_jp: pd.DataFrame,
    start_date: str = '2010-01-01',
    end_date: str = '2014-12-31'
) -> np.ndarray:
    """
    長期相関行列 C_full の計算
    （論文では 2010-2014 年のデータを使用）
    """
    mask = (returns_us.index >= start_date) & (returns_us.index <= end_date)
    ret_us = returns_us.loc[mask]
    ret_jp = returns_jp.loc[mask]
    
    ret_combined = pd.concat([ret_us, ret_jp], axis=1)
    C_full = ret_combined.corr().values
    
    return C_full


def momentum_strategy(
    returns_jp: pd.DataFrame,
    returns_jp_oc: pd.DataFrame,
    window: int = 60,
    quantile: float = 0.3
) -> pd.DataFrame:
    """
    単純モメンタム戦略（ベースライン）
    """
    dates = returns_jp_oc.index[window:]
    strategy_returns = []
    
    for i, date in enumerate(dates):
        window_end = returns_jp.index.get_loc(date)
        window_start = window_end - window
        
        # 過去のリターンの平均（モメンタム）
        ret_window = returns_jp.iloc[window_start:window_end]
        momentum = ret_window.mean()
        
        # ポートフォリオ構築
        weights = build_portfolio(momentum.values, quantile)
        
        # 翌日リターン
        ret_next = returns_jp_oc.iloc[window_end].values
        strategy_ret = np.sum(weights * ret_next)
        
        strategy_returns.append(strategy_ret)
    
    results = pd.DataFrame({
        'date': dates,
        'return': strategy_returns
    })
    results.set_index('date', inplace=True)
    
    return results


def pca_plain_strategy(
    returns_us: pd.DataFrame,
    returns_jp: pd.DataFrame,
    returns_jp_oc: pd.DataFrame,
    config: SubspacePCAConfig,
    sector_labels: dict
) -> pd.DataFrame:
    """
    正則化なし PCA 戦略（ベースライン）
    """
    # C0 を単位行列に設定（正則化なし）
    config_no_reg = SubspacePCAConfig(
        window_length=config.window_length,
        n_factors=config.n_factors,
        lambda_reg=0.0,  # 正則化なし
        quantile=config.quantile
    )
    
    # ダミーの C_full
    C_full_dummy = np.eye(returns_us.shape[1] + returns_jp.shape[1])
    
    results = backtest(
        returns_us, returns_jp, returns_jp_oc,
        config_no_reg, sector_labels, C_full_dummy
    )
    
    return results


def double_sort_strategy(
    returns_us: pd.DataFrame,
    returns_jp: pd.DataFrame,
    returns_jp_oc: pd.DataFrame,
    config: SubspacePCAConfig,
    sector_labels: dict,
    C_full: np.ndarray
) -> pd.DataFrame:
    """
    ダブルソート戦略（モメンタム × PCA SUB）
    """
    dates = returns_jp_oc.index[config.window_length:]
    strategy_returns = []
    
    for i, date in enumerate(dates):
        window_end = returns_jp.index.get_loc(date)
        window_start = window_end - config.window_length
        
        ret_us_window = returns_us.iloc[window_start:window_end].values
        ret_jp_window = returns_jp.iloc[window_start:window_end].values
        ret_us_latest = returns_us.iloc[window_end - 1].values
        
        # PCA SUB シグナル
        signal_generator = LeadLagSignal(config)
        signal_pca = signal_generator.compute_signal(
            ret_us_window, ret_jp_window, ret_us_latest,
            sector_labels, C_full
        )
        
        # モメンタムシグナル
        ret_jp_window_df = pd.DataFrame(ret_jp_window)
        momentum = ret_jp_window_df.mean().values
        
        # ダブルソート（メディアンで分割）
        n_jp = len(signal_pca)
        pca_median = np.median(signal_pca)
        mom_median = np.median(momentum)
        
        weights = np.zeros(n_jp)
        long_count = 0
        short_count = 0
        
        for j in range(n_jp):
            if signal_pca[j] > pca_median and momentum[j] > mom_median:
                long_count += 1
            elif signal_pca[j] < pca_median and momentum[j] < mom_median:
                short_count += 1
        
        if long_count == 0 or short_count == 0:
            strategy_returns.append(0.0)
            continue
        
        for j in range(n_jp):
            if signal_pca[j] > pca_median and momentum[j] > mom_median:
                weights[j] = 1.0 / long_count
            elif signal_pca[j] < pca_median and momentum[j] < mom_median:
                weights[j] = -1.0 / short_count
        
        ret_next = returns_jp_oc.iloc[window_end].values
        strategy_ret = np.sum(weights * ret_next)
        
        strategy_returns.append(strategy_ret)
    
    results = pd.DataFrame({
        'date': dates,
        'return': strategy_returns
    })
    results.set_index('date', inplace=True)
    
    return results


def run_backtest():
    """バックテストの実行"""
    print("=" * 60)
    print("日米業種リードラグ戦略 バックテスト")
    print("=" * 60)
    
    # データのダウンロード
    returns_us, returns_jp, returns_jp_oc = download_data()
    
    # 長期相関行列の計算
    print("\n長期相関行列 C_full の計算中...")
    C_full = compute_C_full(returns_us, returns_jp)
    
    # 設定
    config = SubspacePCAConfig(
        window_length=60,
        n_factors=3,
        lambda_reg=0.9,
        quantile=0.3
    )
    
    # ========================================================================
    # 戦略 1: 提案手法 (PCA SUB)
    # ========================================================================
    print("\n" + "=" * 60)
    print("戦略 1: PCA SUB（部分空間正則化付き PCA）")
    print("=" * 60)
    
    results_sub = backtest(
        returns_us, returns_jp, returns_jp_oc,
        config, SECTOR_LABELS, C_full
    )
    metrics_sub = compute_performance_metrics(results_sub['return'].values)
    
    print(f"年率リターン (AR): {metrics_sub['AR']*100:.2f}%")
    print(f"年率リスク (RISK): {metrics_sub['RISK']*100:.2f}%")
    print(f"リスク・リターン比 (R/R): {metrics_sub['R/R']:.2f}")
    print(f"最大ドローダウン (MDD): {metrics_sub['MDD']*100:.2f}%")
    
    # ========================================================================
    # 戦略 2: 単純モメンタム (MOM)
    # ========================================================================
    print("\n" + "=" * 60)
    print("戦略 2: MOM（単純モメンタム）")
    print("=" * 60)
    
    results_mom = momentum_strategy(returns_jp, returns_jp_oc)
    metrics_mom = compute_performance_metrics(results_mom['return'].values)
    
    print(f"年率リターン (AR): {metrics_mom['AR']*100:.2f}%")
    print(f"年率リスク (RISK): {metrics_mom['RISK']*100:.2f}%")
    print(f"リスク・リターン比 (R/R): {metrics_mom['R/R']:.2f}")
    print(f"最大ドローダウン (MDD): {metrics_mom['MDD']*100:.2f}%")
    
    # ========================================================================
    # 戦略 3: 正則化なし PCA (PCA PLAIN)
    # ========================================================================
    print("\n" + "=" * 60)
    print("戦略 3: PCA PLAIN（正則化なし PCA）")
    print("=" * 60)
    
    results_plain = pca_plain_strategy(
        returns_us, returns_jp, returns_jp_oc,
        config, SECTOR_LABELS
    )
    metrics_plain = compute_performance_metrics(results_plain['return'].values)
    
    print(f"年率リターン (AR): {metrics_plain['AR']*100:.2f}%")
    print(f"年率リスク (RISK): {metrics_plain['RISK']*100:.2f}%")
    print(f"リスク・リターン比 (R/R): {metrics_plain['R/R']:.2f}")
    print(f"最大ドローダウン (MDD): {metrics_plain['MDD']*100:.2f}%")
    
    # ========================================================================
    # 戦略 4: ダブルソート (DOUBLE)
    # ========================================================================
    print("\n" + "=" * 60)
    print("戦略 4: DOUBLE（モメンタム × PCA SUB）")
    print("=" * 60)
    
    results_double = double_sort_strategy(
        returns_us, returns_jp, returns_jp_oc,
        config, SECTOR_LABELS, C_full
    )
    metrics_double = compute_performance_metrics(results_double['return'].values)
    
    print(f"年率リターン (AR): {metrics_double['AR']*100:.2f}%")
    print(f"年率リスク (RISK): {metrics_double['RISK']*100:.2f}%")
    print(f"リスク・リターン比 (R/R): {metrics_double['R/R']:.2f}")
    print(f"最大ドローダウン (MDD): {metrics_double['MDD']*100:.2f}%")
    
    # ========================================================================
    # 結果の比較
    # ========================================================================
    print("\n" + "=" * 60)
    print("戦略比較サマリー")
    print("=" * 60)
    
    summary = pd.DataFrame({
        'Strategy': ['MOM', 'PCA PLAIN', 'PCA SUB', 'DOUBLE'],
        'AR (%)': [
            metrics_mom['AR']*100,
            metrics_plain['AR']*100,
            metrics_sub['AR']*100,
            metrics_double['AR']*100
        ],
        'RISK (%)': [
            metrics_mom['RISK']*100,
            metrics_plain['RISK']*100,
            metrics_sub['RISK']*100,
            metrics_double['RISK']*100
        ],
        'R/R': [
            metrics_mom['R/R'],
            metrics_plain['R/R'],
            metrics_sub['R/R'],
            metrics_double['R/R']
        ],
        'MDD (%)': [
            metrics_mom['MDD']*100,
            metrics_plain['MDD']*100,
            metrics_sub['MDD']*100,
            metrics_double['MDD']*100
        ]
    })
    
    print(summary.to_string(index=False))
    
    # 結果の保存
    summary.to_csv('lead_lag_strategy/backtest_summary.csv', index=False)
    results_sub.to_csv('lead_lag_strategy/results_pca_sub.csv')
    results_mom.to_csv('lead_lag_strategy/results_mom.csv')
    results_plain.to_csv('lead_lag_strategy/results_pca_plain.csv')
    results_double.to_csv('lead_lag_strategy/results_double.csv')
    
    print("\n結果を保存しました：lead_lag_strategy/backtest_summary.csv")
    
    return summary


if __name__ == '__main__':
    summary = run_backtest()
