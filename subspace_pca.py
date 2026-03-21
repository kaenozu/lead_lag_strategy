"""
部分空間正則化付き PCA を用いた日米業種リードラグ投資戦略
Subspace Regularized PCA for Lead-Lag Investment Strategy

Reference: 中川慧 et al. "部分空間正則化付き主成分分析を用いた日米業種リードラグ投資戦略"
"""

import numpy as np
import pandas as pd
from typing import Tuple, List, Dict, Optional
from dataclasses import dataclass


@dataclass
class SubspacePCAConfig:
    """部分空間正則化 PCA の設定"""
    window_length: int = 60  # 推定ウィンドウ長 L
    n_factors: int = 3  # 因子数 K
    lambda_reg: float = 0.9  # 正則化パラメータ λ
    quantile: float = 0.3  # 分位点 q


class SubspaceRegularizedPCA:
    """部分空間正則化付き PCA"""
    
    def __init__(self, config: SubspacePCAConfig):
        self.config = config
        self.V0: Optional[np.ndarray] = None  # 事前固有ベクトル
        self.D0: Optional[np.ndarray] = None  # 事前固有値
        self.C0: Optional[np.ndarray] = None  # 事前エクスポージャー行列
        
    def build_prior_space(
        self,
        n_us: int,
        n_jp: int,
        sector_labels: Dict[str, str],
        C_full: np.ndarray
    ) -> None:
        """
        事前部分空間の構築
        
        Parameters
        ----------
        n_us : int
            米国セクター数
        n_jp : int
            日本セクター数
        sector_labels : dict
            セクターのラベル（'cyclical', 'defensive', 'neutral'）
        C_full : np.ndarray
            長期相関行列
        """
        N = n_us + n_jp
        K0 = 3
        
        # 1. グローバルファクター：全銘柄に等しい重み
        v1 = np.ones(N)
        v1 = v1 / np.linalg.norm(v1)
        
        # 2. 国スプレッドファクター：米国を正，日本を負
        v2 = np.zeros(N)
        v2[:n_us] = 1.0
        v2[n_us:] = -1.0
        # v1 に直交化
        v2 = v2 - np.dot(v2, v1) * v1
        v2 = v2 / np.linalg.norm(v2)
        
        # 3. シクリカル・ディフェンシブファクター
        v3 = np.zeros(N)
        for i, label in sector_labels.items():
            idx = list(sector_labels.keys()).index(i)
            if label == 'cyclical':
                v3[idx] = 1.0
            elif label == 'defensive':
                v3[idx] = -1.0
        # v1, v2 に直交化
        v3 = v3 - np.dot(v3, v1) * v1
        v3 = v3 - np.dot(v3, v2) * v2
        v3 = v3 / (np.linalg.norm(v3) + 1e-10)
        
        V0 = np.column_stack([v1, v2, v3])
        
        # 事前方向の固有値を推定
        D0_raw = V0.T @ C_full @ V0
        D0 = np.diag(np.diag(D0_raw))
        
        # ターゲット行列
        C0_raw = V0 @ D0 @ V0.T
        
        # 相関行列に変換（対角要素で正規化）
        delta = np.diag(C0_raw)
        C0 = np.diag(1.0 / np.sqrt(delta + 1e-10)) @ C0_raw @ np.diag(1.0 / np.sqrt(delta + 1e-10))
        
        # 対角要素を 1 に調整
        np.fill_diagonal(C0, 1.0)
        
        self.V0 = V0
        self.D0 = D0
        self.C0 = C0
    
    def compute_regularized_pca(
        self,
        returns: np.ndarray,
        sector_labels: Dict[str, str],
        C_full: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        部分空間正則化 PCA の計算
        
        Parameters
        ----------
        returns : np.ndarray
            リターン行列 (L x N)
        sector_labels : dict
            セクターラベル
        C_full : np.ndarray
            長期相関行列
            
        Returns
        -------
        V_K : np.ndarray
            上位 K 固有ベクトル
        Lambda : np.ndarray
            固有値
        C_reg : np.ndarray
            正則化相関行列
        """
        if self.C0 is None:
            self.build_prior_space(
                n_us=len([k for k in sector_labels if k.startswith('US_')]),
                n_jp=len([k for k in sector_labels if k.startswith('JP_')]),
                sector_labels=sector_labels,
                C_full=C_full
            )
        
        # 相関行列の計算
        C_t = np.corrcoef(returns.T)
        
        # 正則化相関行列
        lambda_reg = self.config.lambda_reg
        C_reg = (1 - lambda_reg) * C_t + lambda_reg * self.C0
        
        # 固有分解
        eigenvalues, eigenvectors = np.linalg.eigh(C_reg)
        
        # 降順にソート
        idx = np.argsort(eigenvalues)[::-1]
        eigenvalues = eigenvalues[idx]
        eigenvectors = eigenvectors[:, idx]
        
        # 上位 K 個を抽出
        K = self.config.n_factors
        V_K = eigenvectors[:, :K]
        
        return V_K, eigenvalues[:K], C_reg


class LeadLagSignal:
    """日米業種リードラグ・シグナル"""
    
    def __init__(self, config: SubspacePCAConfig):
        self.config = config
        self.pca = SubspaceRegularizedPCA(config)
        
    def compute_signal(
        self,
        returns_us: np.ndarray,  # (L, N_US)
        returns_jp: np.ndarray,  # (L, N_JP)
        returns_us_latest: np.ndarray,  # (N_US,)
        sector_labels: Dict[str, str],
        C_full: np.ndarray
    ) -> np.ndarray:
        """
        リードラグ・シグナルの計算
        
        Parameters
        ----------
        returns_us : np.ndarray
            米国リターン（ウィンドウ分）
        returns_jp : np.ndarray
            日本リターン（ウィンドウ分）
        returns_us_latest : np.ndarray
            米国最新リターン（当日）
        sector_labels : dict
            セクターラベル
        C_full : np.ndarray
            長期相関行列
            
        Returns
        -------
        signal : np.ndarray
            日本セクターの翌日予測シグナル
        """
        # 結合リターン行列
        returns_combined = np.hstack([returns_us, returns_jp])
        
        # 標準化
        mu = np.mean(returns_combined, axis=0)
        sigma = np.std(returns_combined, axis=0) + 1e-10
        returns_std = (returns_combined - mu) / sigma
        
        # 部分空間正則化 PCA
        V_K, _, _ = self.pca.compute_regularized_pca(
            returns_std, sector_labels, C_full
        )
        
        # 米国・日本に分割
        N_US = returns_us.shape[1]
        V_US = V_K[:N_US, :]  # (N_US, K)
        V_JP = V_K[N_US:, :]  # (N_JP, K)
        
        # 米国最新リターンの標準化
        z_us_latest = (returns_us_latest - mu[:N_US]) / sigma[:N_US]
        
        # ファクタースコア
        f_t = V_US.T @ z_us_latest  # (K,)
        
        # 日本側予測シグナル
        signal = V_JP @ f_t  # (N_JP,)
        
        return signal


def build_portfolio(
    signal: np.ndarray,
    quantile: float = 0.3
) -> np.ndarray:
    """
    ロングショートポートフォリオの構築
    
    Parameters
    ----------
    signal : np.ndarray
        シグナル
    quantile : float
        分位点
        
    Returns
    -------
    weights : np.ndarray
        ポートフォリオウェイト
    """
    n = len(signal)
    q = int(np.floor(n * quantile))
    
    # シグナルの上位・下位を抽出
    sorted_idx = np.argsort(signal)
    long_idx = sorted_idx[-q:]  # 上位 q%
    short_idx = sorted_idx[:q]  # 下位 q%
    
    # 等ウェイト
    weights = np.zeros(n)
    weights[long_idx] = 1.0 / q
    weights[short_idx] = -1.0 / q
    
    return weights


def compute_performance_metrics(
    returns: np.ndarray,
    annualization_factor: int = 252
) -> Dict[str, float]:
    """
    パフォーマンス指標の計算
    
    Parameters
    ----------
    returns : np.ndarray
        リターン系列
    annualization_factor : int
        年率換算係数
        
    Returns
    -------
    metrics : dict
        パフォーマンス指標
    """
    # 年率リターン
    ar = np.mean(returns) * annualization_factor
    
    # 年率リスク（標準偏差）
    risk = np.std(returns, ddof=1) * np.sqrt(annualization_factor)
    
    # リスク・リターン比
    rr = ar / risk if risk > 0 else 0.0
    
    # 最大ドローダウン
    cumulative = np.cumprod(1 + returns)
    running_max = np.maximum.accumulate(cumulative)
    drawdown = (cumulative - running_max) / running_max
    mdd = np.min(drawdown)
    
    return {
        'AR': ar,
        'RISK': risk,
        'R/R': rr,
        'MDD': mdd
    }


def backtest(
    returns_us: pd.DataFrame,
    returns_jp: pd.DataFrame,
    returns_jp_oc: pd.DataFrame,  # Open-to-Close リターン
    config: SubspacePCAConfig,
    sector_labels: Dict[str, str],
    C_full: np.ndarray,
    warmup: int = 60
) -> pd.DataFrame:
    """
    バックテストの実行
    
    Parameters
    ----------
    returns_us : pd.DataFrame
        米国 Close-to-Close リターン
    returns_jp : pd.DataFrame
        日本 Close-to-Close リターン
    returns_jp_oc : pd.DataFrame
        日本 Open-to-Close リターン
    config : SubspacePCAConfig
        設定
    sector_labels : dict
        セクターラベル
    C_full : np.ndarray
        長期相関行列
    warmup : int
        ウォームアップ期間
        
    Returns
    -------
    results : pd.DataFrame
        バックテスト結果
    """
    dates = returns_jp_oc.index[warmup:]
    n_jp = returns_jp.shape[1]
    
    strategy_returns = []
    
    for i, date in enumerate(dates):
        # ウィンドウの取得
        window_end = returns_jp.index.get_loc(date)
        window_start = window_end - config.window_length
        
        ret_us_window = returns_us.iloc[window_start:window_end].values
        ret_jp_window = returns_jp.iloc[window_start:window_end].values
        ret_us_latest = returns_us.iloc[window_end - 1].values
        
        # シグナルの計算
        signal_generator = LeadLagSignal(config)
        signal = signal_generator.compute_signal(
            ret_us_window,
            ret_jp_window,
            ret_us_latest,
            sector_labels,
            C_full
        )
        
        # ポートフォリオの構築
        weights = build_portfolio(signal, config.quantile)
        
        # 翌日リターン（Open-to-Close）
        ret_next = returns_jp_oc.iloc[window_end].values
        strategy_ret = np.sum(weights * ret_next)
        
        strategy_returns.append(strategy_ret)
    
    results = pd.DataFrame({
        'date': dates,
        'return': strategy_returns
    })
    results.set_index('date', inplace=True)
    
    return results


if __name__ == '__main__':
    # テスト用
    print("部分空間正則化付き PCA リードラグ戦略モジュール")
    print("このモジュールは backtest() 関数を使用してバックテストを実行します")
