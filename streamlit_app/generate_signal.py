"""
日米業種リードラグ戦略 - シグナル生成（Python 版）

Streamlit Cloud 環境用
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
import requests

# yfinance の使用を試みる（なければ requests で直接取得）
USE_YFINANCE = False
try:
    import yfinance as yf
    USE_YFINANCE = True
    print("✅ yfinance を使用します")
except ImportError:
    print("ℹ️ yfinance がないため、requests で直接データ取得します")


def fetch_etf_data(tickers: list[str], period: str = "1y") -> dict[str, pd.DataFrame]:
    """ETF データを取得"""
    data = {}
    
    if USE_YFINANCE:
        # yfinance を使用
        for ticker in tickers:
            try:
                df = yf.download(ticker, period=period, progress=False)
                if len(df) > 0:
                    data[ticker] = df
            except Exception as e:
                print(f"Error fetching {ticker}: {e}")
    else:
        # requests で直接 Yahoo Finance から取得
        period_map = {"1y": 365, "6mo": 180, "3mo": 90}
        days = period_map.get(period, 365)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        for ticker in tickers:
            try:
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
                params = {
                    "period1": int(start_date.timestamp()),
                    "period2": int(end_date.timestamp()),
                    "interval": "1d"
                }
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                result = response.json()
                
                if result.get("chart", {}).get("result"):
                    chart_data = result["chart"]["result"][0]
                    timestamps = chart_data["timestamp"]
                    quotes = chart_data["indicators"]["quote"][0]
                    
                    df = pd.DataFrame({
                        "Date": pd.to_datetime(timestamps, unit="s"),
                        "Close": quotes["close"]
                    })
                    df = df.set_index("Date")
                    df = df.dropna()
                    
                    if len(df) > 0:
                        data[ticker] = df
            except Exception as e:
                print(f"Error fetching {ticker} via requests: {e}")
    
    return data


def calculate_returns(prices: pd.Series) -> pd.Series:
    """対数リターン計算"""
    return np.log(prices / prices.shift(1)).dropna()


def build_return_matrix(data: dict[str, pd.DataFrame]) -> np.ndarray:
    """リターン行列構築"""
    returns_list = []
    for ticker, df in data.items():
        close = df['Close'] if isinstance(df, pd.DataFrame) else df
        returns = calculate_returns(close)
        returns_list.append(returns.values)
    
    # 日付を揃えて行列化
    max_len = min(len(r) for r in returns_list)
    returns_matrix = np.array([r[-max_len:] for r in returns_list])
    return returns_matrix.T  # 日数 × 銘柄数


def pca_subspace_signal(returns: np.ndarray, n_factors: int = 3, 
                        lambda_reg: float = 0.9, window: int = 60) -> np.ndarray:
    """
    部分空間正則化 PCA シグナル（簡易版）
    
    注意：これは簡易実装です。完全な実装は lib/pca/subspace.js を参照
    """
    if len(returns) < window:
        # データが不足している場合は単純モメンタム
        momentum = returns[-1] - returns[-min(window, len(returns))]
        return momentum
    
    # 直近 window 日のデータを使用
    window_returns = returns[-window:]
    
    # 相関行列計算
    corr_matrix = np.corrcoef(window_returns.T)
    
    # 固有値分解（簡易版）
    try:
        eigenvalues, eigenvectors = np.linalg.eigh(corr_matrix)
        # 上位 n_factors 個の固有値・固有ベクトルを取得
        idx = np.argsort(eigenvalues)[::-1][:n_factors]
        eigenvalues = eigenvalues[idx]
        eigenvectors = eigenvectors[:, idx]
    except Exception:
        # 固有値分解失敗時は単純平均
        eigenvectors = np.ones((corr_matrix.shape[0], n_factors)) / np.sqrt(n_factors)
    
    # 最新リターンを射影
    latest_returns = returns[-1]
    factor_scores = latest_returns @ eigenvectors
    
    # シグナル復元
    signal = factor_scores @ eigenvectors.T
    
    return signal.sum(axis=1)


def generate_signal() -> dict:
    """シグナル生成"""
    # 銘柄リスト
    US_ETF_TICKERS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 
                      'XLP', 'XLRE', 'XLU', 'XLV', 'XLY']
    JP_ETF_TICKERS = ['1617.T', '1618.T', '1619.T', '1620.T', '1621.T',
                      '1622.T', '1623.T', '1624.T', '1625.T', '1626.T',
                      '1627.T', '1628.T', '1629.T', '1630.T', '1631.T',
                      '1632.T', '1633.T']
    
    # セクターラベル
    SECTOR_LABELS = {
        '1617.T': '食品', '1618.T': 'エネルギー資源', '1619.T': '化学',
        '1620.T': '素材・化学', '1621.T': '医薬品', '1622.T': '鉄鋼',
        '1623.T': '鉄鋼・非鉄', '1624.T': '機械', '1625.T': '電機・精密',
        '1626.T': '自動車', '1627.T': '電力・ガス', '1628.T': '運輸',
        '1629.T': '商社・卸売', '1630.T': '小売', '1631.T': '銀行',
        '1632.T': '証券・商品', '1633.T': '保険'
    }
    
    print("📡 データ取得中...")
    
    # データ取得
    all_tickers = US_ETF_TICKERS + JP_ETF_TICKERS

    if USE_YFINANCE:
        data = fetch_etf_data(all_tickers, period="1y")
    else:
        # requests で直接取得
        print("📡 requests でデータ取得中...")
        data = fetch_etf_data(all_tickers, period="1y")
    
    if not data:
        return {"error": "データ取得に失敗しました"}
    
    print(f"📊 {len(list(data.values())[0])} days of data retrieved")
    
    # リターン計算
    print("📈 リターン計算中...")
    returns_dict = {}
    for ticker, df in data.items():
        close = df['Close'] if isinstance(df, pd.DataFrame) else df
        returns_dict[ticker] = calculate_returns(close)
    
    # 共通の期間に揃える
    min_len = min(len(r) for r in returns_dict.values())
    returns_array = np.array([list(r.values[-min_len:]) for r in returns_dict.values()]).T
    
    # シグナル生成
    print("📉 シグナル生成中...")
    signals = pca_subspace_signal(returns_array, n_factors=3, lambda_reg=0.9, window=60)
    
    # 結果構築
    results = []
    for i, ticker in enumerate(returns_dict.keys()):
        if ticker in JP_ETF_TICKERS:
            # numpy 配列を Python スカラーに変換
            signal_val = signals[i]
            if hasattr(signal_val, 'item'):
                signal_val = signal_val.item()
            results.append({
                'ticker': ticker,
                'sector': SECTOR_LABELS.get(ticker, 'Unknown'),
                'signal': float(signal_val),
                'region': 'JP'
            })
    
    # シグナルでソート
    results.sort(key=lambda x: x['signal'], reverse=True)
    
    # 統計量
    signal_values = [r['signal'] for r in results]
    
    return {
        'timestamp': datetime.now().isoformat(),
        'signals': results,
        'config': {
            'windowLength': 60,
            'lambdaReg': 0.9,
            'quantile': 0.4,
            'nFactors': 3
        },
        'statistics': {
            'mean': float(np.mean(signal_values)),
            'std': float(np.std(signal_values)),
            'max': float(np.max(signal_values)),
            'min': float(np.min(signal_values))
        }
    }


def main():
    """メイン処理"""
    print("=" * 60)
    print("📊 日米業種リードラグ戦略 - シグナル生成（Python 版）")
    print("=" * 60)
    
    result = generate_signal()
    
    if 'error' in result:
        print(f"❌ エラー：{result['error']}")
        return
    
    # 結果表示
    print("\n" + "=" * 60)
    print("📈 買い銘柄（ロング）")
    print("=" * 60)
    
    long_candidates = [r for r in result['signals'] if r['signal'] > 0][:6]
    for rank, r in enumerate(long_candidates, 1):
        print(f"Rank {rank:2d}  {r['ticker']:8s}  {r['sector']:12s}  {r['signal']:8.2f}")
    
    print("\n" + "=" * 60)
    print("📉 売り銘柄（ショート）")
    print("=" * 60)
    
    short_candidates = [r for r in result['signals'] if r['signal'] < 0][:6]
    short_candidates.sort(key=lambda x: x['signal'])
    for rank, r in enumerate(short_candidates, 1):
        print(f"Rank {rank:2d}  {r['ticker']:8s}  {r['sector']:12s}  {r['signal']:8.2f}")
    
    print("\n" + "=" * 60)
    print("📊 シグナル統計")
    print("=" * 60)
    stats = result['statistics']
    print(f"  平均：{stats['mean']:.4f}")
    print(f"  標準偏差：{stats['std']:.4f}")
    print(f"  最大：{stats['max']:.4f}")
    print(f"  最小：{stats['min']:.4f}")
    
    # 結果を保存
    output_dir = Path(__file__).parent.parent / 'results'
    output_dir.mkdir(exist_ok=True)
    
    with open(output_dir / 'signal_python.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 Results saved to: {output_dir / 'signal_python.json'}")
    print("\n✅ シグナル生成完了")


if __name__ == '__main__':
    main()
