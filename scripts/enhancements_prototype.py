"""
改善案プロトタイプ – 3 提案の数値検証
Enhancement Prototype: Numerical Validation of 3 Proposals

提案 1: EWMA 相関行列 (Exponentially Weighted Moving Average Correlation)
提案 2: シグナル正規化 (Rolling Volatility-Scaled Signal)
提案 3: 適応的 λ    (Adaptive Regularization Strength)
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple


# ============================================================
# 共通ユーティリティ
# ============================================================

def sample_corr(X: np.ndarray) -> np.ndarray:
    """現行の標本相関行列 (L × N) -> (N × N)"""
    return np.corrcoef(X.T)


# ============================================================
# 改善 1: EWMA 相関行列
# ============================================================

def ewma_corr(X: np.ndarray, halflife: float = 30.0) -> np.ndarray:
    """
    EWMA 相関行列
    
    数式:
        α = 1 - 2^(-1/halflife)        ← RiskMetrics 流の半減期換算
        Σ_t = (1-α) * r_t r_t^T + α * Σ_{t-1}   ← 指数加重共分散
        C_t[i,j] = Σ_t[i,j] / sqrt(Σ_t[i,i] * Σ_t[j,j])  ← 相関に変換
    
    通常の sample_corr との違い:
        - 直近観測に高いウェイト → 市場レジーム変化に素早く追随
        - 半減期 30 日: 今日の重みは 30 日前の 2 倍
        - 半減期 60 日: より平滑 (現行 L=60 窓の等ウェイトに近い)
    
    Parameters
    ----------
    X : np.ndarray  shape (L, N)
        リターン行列
    halflife : float
        半減期 (日数)
    """
    L, N = X.shape
    alpha = 1.0 - 0.5 ** (1.0 / halflife)
    
    # 重みの計算 (t=L-1 が最新)
    # w[i] = α * (1-α)^{L-1-i}  (未正規化)
    indices = np.arange(L)
    weights = alpha * (1 - alpha) ** (L - 1 - indices)
    weights /= weights.sum()          # 正規化
    
    # 加重平均
    mu = weights @ X                   # (N,)
    X_c = X - mu                       # センタリング
    
    # 加重共分散
    W = np.diag(weights)
    cov = X_c.T @ W @ X_c             # (N, N)
    
    # 相関行列に変換
    d = np.sqrt(np.diag(cov))
    d = np.where(d < 1e-10, 1e-10, d)
    corr = cov / np.outer(d, d)
    np.fill_diagonal(corr, 1.0)
    return corr


def compare_corr_matrices(X: np.ndarray, halflife: float = 30.0) -> Dict:
    """標本相関 vs EWMA 相関の差異統計"""
    C_sample = sample_corr(X)
    C_ewma   = ewma_corr(X, halflife)
    diff = C_ewma - C_sample
    off_diag = diff[~np.eye(len(diff), dtype=bool)]
    return {
        "mean_abs_diff": float(np.mean(np.abs(off_diag))),
        "max_abs_diff":  float(np.max(np.abs(off_diag))),
        "std_diff":      float(np.std(off_diag)),
    }


# ============================================================
# 改善 2: ローリング・ボラティリティ正規化シグナル
# ============================================================

def rolling_vol_scale(
    raw_signals: np.ndarray,
    vol_window: int = 21,
    target_vol: float = 1.0
) -> np.ndarray:
    """
    ローリング・ボラティリティ正規化
    
    数式:
        σ_t = std(signal_{t-w:t})   ← 直近 vol_window 期間の標準偏差
        signal_scaled[t] = signal[t] * (target_vol / max(σ_t, ε))
    
    根拠:
        - 高ボラ局面 (COVID 等) でのサイズリスクを制御
        - シグナルの「単位」を標準化 → 分位閾値が安定
        - Sharpe 改善: 大外れによる fat-tail を平滑化
    
    Parameters
    ----------
    raw_signals : (T,)  各日のシグナルスコアのスカラー値（ポートフォリオ P&L）
    vol_window  : int   ローリング標準偏差の窓
    target_vol  : float 目標ボラティリティ
    """
    T = len(raw_signals)
    scaled = raw_signals.copy()
    for t in range(vol_window, T):
        window = raw_signals[t - vol_window:t]
        sigma = np.std(window, ddof=1)
        if sigma > 1e-10:
            scaled[t] = raw_signals[t] * (target_vol / sigma)
    return scaled


def apply_signal_vol_norm(
    signals_matrix: np.ndarray,   # (T, N_JP): 各日×各JP銘柄のシグナル
    vol_window: int = 21
) -> np.ndarray:
    """
    各 JP 銘柄のシグナルを列ごとにローリング・ボラティリティ正規化
    
    Parameters
    ----------
    signals_matrix : (T, N_JP)
    vol_window : int
    
    Returns
    -------
    normalized : (T, N_JP)
    """
    T, N = signals_matrix.shape
    normalized = signals_matrix.copy()
    for j in range(N):
        normalized[:, j] = rolling_vol_scale(signals_matrix[:, j], vol_window)
    return normalized


# ============================================================
# 改善 3: 適応的 λ（市場ボラティリティ連動）
# ============================================================

def compute_realized_vol(
    returns: np.ndarray,    # (T, N)
    vol_window: int = 20
) -> np.ndarray:
    """
    等ウェイトポートフォリオの実現ボラティリティ (T,)
    """
    avg_ret = returns.mean(axis=1)   # (T,)
    T = len(avg_ret)
    rv = np.full(T, np.nan)
    for t in range(vol_window, T):
        rv[t] = np.std(avg_ret[t - vol_window:t], ddof=1) * np.sqrt(252)
    return rv


def adaptive_lambda(
    realized_vol: float,
    lambda_min: float = 0.5,
    lambda_max: float = 0.95,
    vol_low: float = 0.08,    # 8% 以下 → λ = λ_max
    vol_high: float = 0.30,   # 30% 以上 → λ = λ_min
) -> float:
    """
    適応的正則化強度
    
    数式:
        x = clip((σ_t - vol_low) / (vol_high - vol_low), 0, 1)
        λ_t = λ_max - x * (λ_max - λ_min)
    
    根拠:
        - 低ボラ (σ < 8%):  λ_max=0.95 → 事前 C0 を強く信頼
          (市場が落ち着いている → セクター構造が安定 → 事前知識有効)
        - 高ボラ (σ > 30%): λ_min=0.5 → 直近データを強く反映
          (クラッシュ時はセクター相関が崩れる → データ主導に切替)
        - 境界はスムーズに線形補間
    
    Parameters
    ----------
    realized_vol : float   年率ボラティリティ
    """
    x = np.clip((realized_vol - vol_low) / (vol_high - vol_low), 0.0, 1.0)
    return float(lambda_max - x * (lambda_max - lambda_min))


def adaptive_lambda_series(
    returns_us: np.ndarray,   # (T, N_US)
    returns_jp: np.ndarray,   # (T, N_JP)
    vol_window: int = 20,
    **kwargs
) -> np.ndarray:
    """
    全期間にわたる日次 λ 系列を計算
    """
    returns_all = np.hstack([returns_us, returns_jp])
    rv = compute_realized_vol(returns_all, vol_window)
    lam = np.array([
        adaptive_lambda(float(v), **kwargs) if not np.isnan(v) else kwargs.get('lambda_max', 0.95)
        for v in rv
    ])
    return lam


# ============================================================
# バックテスト比較ランナー
# ============================================================

@dataclass
class BacktestConfig:
    window_length: int = 60
    n_factors: int = 3
    lambda_reg: float = 0.9
    quantile: float = 0.4
    # 改善オプション
    use_ewma: bool = False
    ewma_halflife: float = 30.0
    use_signal_vol_norm: bool = False
    signal_vol_window: int = 21
    use_adaptive_lambda: bool = False
    lambda_min: float = 0.5
    lambda_max: float = 0.95


def build_prior_space(n_us: int, n_jp: int, sector_labels: dict, C_full: np.ndarray, keys: list) -> np.ndarray:
    """事前部分空間 C0 を構築"""
    N = n_us + n_jp
    v1 = np.ones(N) / np.sqrt(N)
    v2 = np.concatenate([np.ones(n_us), -np.ones(n_jp)])
    v2 -= np.dot(v2, v1) * v1
    norm2 = np.linalg.norm(v2)
    v2 = v2 / norm2 if norm2 > 1e-10 else v2
    v3 = np.array([1.0 if sector_labels.get(k) == 'cyclical' else
                   (-1.0 if sector_labels.get(k) == 'defensive' else 0.0) for k in keys])
    v3 -= np.dot(v3, v1) * v1
    v3 -= np.dot(v3, v2) * v2
    norm3 = np.linalg.norm(v3)
    v3 = v3 / norm3 if norm3 > 1e-10 else v3
    V0 = np.column_stack([v1, v2, v3])
    D0 = np.diag(np.diag(V0.T @ C_full @ V0))
    C0_raw = V0 @ D0 @ V0.T
    delta = np.diag(C0_raw)
    inv_sq = 1.0 / np.sqrt(np.maximum(delta, 1e-10))
    C0 = np.diag(inv_sq) @ C0_raw @ np.diag(inv_sq)
    np.fill_diagonal(C0, 1.0)
    return C0


def run_backtest_with_options(
    returns_us: np.ndarray,    # (T, N_US)  Close-to-Close
    returns_jp: np.ndarray,    # (T, N_JP)  Close-to-Close
    returns_jp_oc: np.ndarray, # (T, N_JP)  Open-to-Close  ← P&L
    C_full: np.ndarray,
    sector_labels: dict,
    keys: list,
    cfg: BacktestConfig,
) -> np.ndarray:
    """
    設定オプションに応じた改善済みバックテスト
    Returns: 日次ストラテジーリターン (T - warmup,)
    """
    T = returns_us.shape[0]
    N_US = returns_us.shape[1]
    N_JP = returns_jp.shape[1]
    warmup = cfg.window_length

    # 適応的 λ 系列を事前計算
    if cfg.use_adaptive_lambda:
        lam_series = adaptive_lambda_series(
            returns_us, returns_jp,
            lambda_min=cfg.lambda_min,
            lambda_max=cfg.lambda_max,
        )
    else:
        lam_series = np.full(T, cfg.lambda_reg)

    # 事前 C0
    C0 = build_prior_space(N_US, N_JP, sector_labels, C_full, keys)

    strategy_returns = []
    raw_signals_log = []   # signal vol norm 用バッファ

    for t in range(warmup, T):
        start = t - cfg.window_length
        X_us = returns_us[start:t, :]    # (L, N_US)
        X_jp = returns_jp[start:t, :]    # (L, N_JP)
        X = np.hstack([X_us, X_jp])      # (L, N)

        # --- 相関行列 (改善 1) ---
        if cfg.use_ewma:
            C_t = ewma_corr(X, halflife=cfg.ewma_halflife)
        else:
            C_t = sample_corr(X)

        # --- 正則化相関行列 (改善 3 で λ が変わる) ---
        lam = float(lam_series[t])
        C_reg = (1 - lam) * C_t + lam * C0

        # --- PCA (固有分解) ---
        eigvals, eigvecs = np.linalg.eigh(C_reg)
        idx = np.argsort(eigvals)[::-1]
        VK = eigvecs[:, idx[:cfg.n_factors]]   # (N, K)

        # --- 標準化 ---
        mu = X.mean(axis=0)
        sigma = X.std(axis=0) + 1e-10
        z_latest = (returns_us[t, :] - mu[:N_US]) / sigma[:N_US]

        # --- ファクタースコア & シグナル ---
        V_US = VK[:N_US, :]       # (N_US, K)
        V_JP = VK[N_US:, :]       # (N_JP, K)
        f_t = V_US.T @ z_latest   # (K,)
        signal = V_JP @ f_t       # (N_JP,)

        raw_signals_log.append(signal)

        # --- シグナル正規化 (改善 2) は後処理 ---
        strategy_returns.append(None)   # プレースホルダー

    raw_signals_array = np.array(raw_signals_log)   # (T-warmup, N_JP)

    # 改善 2: シグナル vol 正規化
    if cfg.use_signal_vol_norm:
        raw_signals_array = apply_signal_vol_norm(
            raw_signals_array, cfg.signal_vol_window
        )

    # --- ポートフォリオ & P&L ---
    results = []
    q = max(1, int(np.floor(N_JP * cfg.quantile)))
    for i, signal in enumerate(raw_signals_array):
        sorted_idx = np.argsort(signal)
        long_idx = sorted_idx[-q:]
        short_idx = sorted_idx[:q]
        weights = np.zeros(N_JP)
        weights[long_idx] = 1.0 / q
        weights[short_idx] = -1.0 / q
        ret_next = returns_jp_oc[warmup + i, :]
        results.append(float(np.dot(weights, ret_next)))

    return np.array(results)


def compute_metrics(returns: np.ndarray, ann: int = 252) -> dict:
    """パフォーマンス指標"""
    if len(returns) == 0:
        return {"AR": 0, "RISK": 0, "Sharpe": 0, "MDD": 0}
    ar = returns.mean() * ann
    risk = returns.std(ddof=1) * np.sqrt(ann)
    sharpe = ar / risk if risk > 0 else 0.0
    cum = np.cumprod(1 + returns)
    mdd = float(np.min((cum - np.maximum.accumulate(cum)) / np.maximum.accumulate(cum)))
    return {"AR": ar, "RISK": risk, "Sharpe": sharpe, "MDD": mdd, "Cumulative": float(cum[-1])}


# ============================================================
# シミュレーション（合成データで比較）
# ============================================================

def generate_synthetic_data(
    T: int = 500,
    n_us: int = 11,
    n_jp: int = 17,
    seed: int = 42
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    日米業種 ETF を模したリターン系列を生成
    - 3 つの共通ファクター (グローバル / 国スプレッド / 景気敏感)
    - 米国が日本より 1 日先行 (リードラグ)
    """
    rng = np.random.default_rng(seed)
    N = n_us + n_jp

    # 因子ローディング行列 (N, 3)
    # ファクター 1: 全員正 (グローバル)
    # ファクター 2: 米国正、日本負
    # ファクター 3: Cyclical 正、Defensive 負
    B = rng.normal(0, 0.5, (N, 3))
    B[:n_us, 1] += 0.5
    B[n_us:, 1] -= 0.5

    # 米国が 1 ステップ先行する構造
    factors = rng.normal(0, 1, (T + 1, 3))
    factors[:, 0] *= 0.8   # 第 1 ファクターはやや小さく
    idio = rng.normal(0, 0.5, (T + 1, N))

    returns_all = factors @ B.T + idio        # (T+1, N)
    returns_all *= 0.01                        # スケールを 1% 日次程度に

    # 日本は t 日の US ファクターが t+1 日に影響する (リードラグ)
    returns_us  = returns_all[1:, :n_us]       # (T, N_US)
    returns_jp  = returns_all[:-1, n_us:]      # (T, N_JP)  ← 1 日遅れ
    returns_jp_oc = returns_jp * rng.uniform(0.4, 0.8, returns_jp.shape)

    return returns_us, returns_jp, returns_jp_oc


def run_comparison():
    """4 戦略の比較: ベースライン / EWMA / Signal-Norm / 適応 λ"""
    print("=" * 65)
    print("改善案プロトタイプ – 合成データによる比較検証")
    print("=" * 65)

    T = 800
    n_us, n_jp = 11, 17
    returns_us, returns_jp, returns_jp_oc = generate_synthetic_data(T, n_us, n_jp)

    # 事前相関行列 (全期間)
    C_full = sample_corr(np.hstack([returns_us, returns_jp]))
    sector_labels = {
        **{f"US_{i}": ["cyclical", "defensive", "neutral"][i % 3] for i in range(n_us)},
        **{f"JP_{i}": ["cyclical", "defensive", "neutral"][i % 3] for i in range(n_jp)},
    }
    keys = list(sector_labels.keys())

    # --- 各設定の定義 ---
    configs = {
        "Baseline  (current)":
            BacktestConfig(use_ewma=False, use_signal_vol_norm=False, use_adaptive_lambda=False),
        "EWMA-30   (改善1)":
            BacktestConfig(use_ewma=True, ewma_halflife=30.0,
                           use_signal_vol_norm=False, use_adaptive_lambda=False),
        "SigVolNorm(改善2)":
            BacktestConfig(use_ewma=False, use_signal_vol_norm=True, signal_vol_window=21,
                           use_adaptive_lambda=False),
        "Adaptiveλ (改善3)":
            BacktestConfig(use_ewma=False, use_signal_vol_norm=False,
                           use_adaptive_lambda=True, lambda_min=0.5, lambda_max=0.95),
        "全改善複合  (1+2+3)":
            BacktestConfig(use_ewma=True, ewma_halflife=30.0,
                           use_signal_vol_norm=True, signal_vol_window=21,
                           use_adaptive_lambda=True, lambda_min=0.5, lambda_max=0.95),
    }

    print(f"\n{'Strategy':<20} {'AR%':>7} {'Risk%':>7} {'Sharpe':>7} {'MDD%':>7} {'Cumul':>7}")
    print("-" * 65)

    results_all = {}
    for name, cfg in configs.items():
        rets = run_backtest_with_options(
            returns_us, returns_jp, returns_jp_oc,
            C_full, sector_labels, keys, cfg
        )
        m = compute_metrics(rets)
        results_all[name] = {"returns": rets, "metrics": m}
        print(
            f"{name:<20} "
            f"{m['AR']*100:>7.2f} "
            f"{m['RISK']*100:>7.2f} "
            f"{m['Sharpe']:>7.3f} "
            f"{m['MDD']*100:>7.2f} "
            f"{m['Cumulative']:>7.3f}"
        )

    # --- EWMA vs Sample 相関の差異確認 ---
    print("\n--- 改善 1: EWMA 相関行列の差異分析 ---")
    X_sample = np.hstack([returns_us[:60, :], returns_jp[:60, :]])
    for hl in [15, 30, 60]:
        diff = compare_corr_matrices(X_sample, halflife=hl)
        print(f"  halflife={hl:2d}d: mean|Δ|={diff['mean_abs_diff']:.4f}  "
              f"max|Δ|={diff['max_abs_diff']:.4f}  std(Δ)={diff['std_diff']:.4f}")

    # --- 適応 λ の変動確認 ---
    print("\n--- 改善 3: 適応 λ の分布 ---")
    lam_series = adaptive_lambda_series(returns_us, returns_jp)
    print(f"  λ 範囲: [{lam_series.min():.3f}, {lam_series.max():.3f}]  "
          f"mean={lam_series.mean():.3f}  std={lam_series.std():.3f}")
    lam_valid = lam_series[~np.isnan(lam_series)]
    percentiles = np.percentile(lam_valid, [5, 25, 50, 75, 95])
    print(f"  パーセンタイル (5/25/50/75/95): "
          f"{' / '.join(f'{p:.3f}' for p in percentiles)}")

    # --- Sharpe 改善サマリー ---
    print("\n--- Sharpe レシオ改善 (vs Baseline) ---")
    base_sharpe = results_all["Baseline  (current)"]["metrics"]["Sharpe"]
    for name, res in results_all.items():
        if name == "Baseline  (current)":
            continue
        delta = res["metrics"]["Sharpe"] - base_sharpe
        sign = "+" if delta >= 0 else ""
        print(f"  {name:<20}: {sign}{delta:+.4f}")

    print("\n完了。詳細は各数値の下にある解説を参照。")
    return results_all


if __name__ == "__main__":
    run_comparison()
