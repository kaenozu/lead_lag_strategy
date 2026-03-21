# 日米業種リードラグ戦略 - プロジェクト概要

## プロジェクト概要

部分空間正則化付き PCA（Principal Component Analysis）を用いた**日米業種リードラグ投資戦略**の実装プロジェクト。米国の業種 ETF リターンから日本業種 ETF のリターンを予測し、ロングショートポートフォリオを構築する定量的投資システム。

### 学術的基盤

- **参照論文**: 中川慧 et al. "部分空間正則化付き主成分分析を用いた日米業種リードラグ投資戦略"
- **核心技術**: 部分空間正則化 PCA による低ランク予測器
- **事前部分空間**: グローバルファクター・国スプレッドファクター・シクリカルファクター

## アーキテクチャ

```
lead_lag_strategy/
├── server.js              # Web サーバー（Express.js）
├── public/                # フロントエンド（HTML/CSS/JS）
├── backtest.js            # サンプルデータ版バックテスト
├── backtest_real.js       # 実市場データ版（パラメータ最適化付き）
├── backtest_improved.js   # 改良版バックテスト
├── subspace_pca.py        # Python 参考実装
├── data/                  # ETF 日次データ（CSV）
│   ├── XLB.csv ~ XLY.csv  # 米国セクター ETF（11 銘柄）
│   └── 1617.T.csv ~ 1633.T.csv # 日本セクター ETF（17 銘柄）
└── results/               # バックテスト結果
    ├── backtest_summary_*.csv
    ├── cumulative_*.csv
    └── optimal_parameters.csv
```

## 主要技術スタック

| 区分 | 技術 |
|------|------|
| バックエンド | Node.js (CommonJS) |
| Web フレームワーク | Express.js v5 |
| データ取得 | yahoo-finance2, axios |
| 数値計算 | 独自実装（行列演算、固有値分解） |
| フロントエンド | Vanilla JS, Chart.js |

## バックテスト結果（2018-2025 年）

### 戦略比較サマリー

| 戦略 | 年率リターン (%) | リスク (%) | R/R 比 | 最大 DD (%) | 累積 (%) |
|------|-----------------|------------|--------|-------------|----------|
| MOM（モメンタム） | 1.40 | 10.11 | 0.14 | -20.12 | 6.26 |
| PCA PLAIN（正則化なし） | 2.81 | 9.74 | 0.29 | -16.06 | 17.23 |
| **PCA SUB（提案手法）** | **6.93** | **8.33** | **0.83** | **-20.63** | **56.59** |
| DOUBLE（モメンタム×PCA） | 0.29 | 16.35 | 0.02 | -38.19 | -6.83 |

### 最適パラメータ

| パラメータ | 値 | 説明 |
|------------|-----|------|
| `windowLength` | 60 | 推定ウィンドウ長（日） |
| `lambdaReg` | 0.9 | 正則化強度（0=なし，1=事前空間のみ） |
| `quantile` | 0.4 | 分位点（上位・下位 40% を取引） |
| `nFactors` | 3 | 因子数 |

### 論文結果との比較

| 指標 | 論文 (2010-2025) | 本実装 (2018-2025) | 差分 |
|------|-----------------|-------------------|------|
| 年率リターン | 23.79% | 6.93% | -16.86% |
| R/R 比 | 2.22 | 0.83 | -1.39 |
| 最大 DD | 9.58% | -20.63% | -11.05% |

## 実行方法

### バックテスト実行

```bash
cd c:\gemini-desktop\lead_lag_strategy
node backtest.js              # サンプルデータ（即時完了）
node backtest_real.js         # 実市場データ（数分）
node backtest_improved.js     # パラメータ最適化（10 分程度）
```

### Web サーバー起動

```bash
node server.js
# http://localhost:3000 にアクセス
```

### API エンドポイント

| メソッド | エンドポイント | 説明 |
|----------|---------------|------|
| POST | `/api/backtest` | バックテスト実行 |
| POST | `/api/signal` | 銘柄シグナル生成 |
| GET | `/api/config` | 設定取得 |
| POST | `/api/config` | 設定更新 |

## 戦略の仕組み

### 1. 部分空間正則化 PCA

```
C_reg = (1 - λ) * C_t + λ * C_0
```

- `C_t`: 標本期間の相関行列
- `C_0`: 事前部分空間から構築したターゲット行列
- `λ`: 正則化パラメータ（0.9 が最適）

### 2. 事前部分空間の構成

1. **グローバルファクター**: 全銘柄に等しい重み
2. **国スプレッドファクター**: 米国 (+) vs 日本 (-)
3. **シクリカルファクター**: 景気循環関連銘柄

### 3. リードラグ予測

1. 米国最新リターンを固有ベクトルに射影
2. 射影された因子スコアを日本銘柄に復元
3. シグナル値に基づきロングショート構築

## 使用 ETF

### 米国（11 セクター）

| ティッカー | 業種 | タイプ |
|------------|------|--------|
| XLB | Materials | Cyclical |
| XLC | Communication Services | Neutral |
| XLE | Energy | Cyclical |
| XLF | Financials | Cyclical |
| XLI | Industrials | Neutral |
| XLK | Information Technology | Defensive |
| XLP | Consumer Staples | Defensive |
| XLRE | Real Estate | Cyclical |
| XLU | Utilities | Defensive |
| XLV | Health Care | Defensive |
| XLY | Consumer Discretionary | Neutral |

### 日本（17 セクター・TOPIX-17 業種別）

1617.T（食品）〜 1633.T（保険）までの 17 銘柄

## 開発状況

- [x] 基本アルゴリズム実装（backtest.js）
- [x] 実市場データ対応（backtest_real.js）
- [x] パラメータ最適化（グリッドサーチ）
- [x] Web UI 実装
- [x] 複数戦略比較（MOM, PCA PLAIN, DOUBLE）
- [ ] 取引コストの精密化
- [ ] サブサンプル分析
- [ ] ファクターモデルによるリスク調整

## 留意点

1. **データ期間制約**: 日本 ETF データは 2018 年以降のみ利用可能
2. **ルックアヘッドバイアス**: 事前部分空間構築に全期間使用（簡易版）
3. **取引コスト**: スリッページ 0.1%、手数料 0.05% を想定
4. **再現性**: 固有値分解のべき乗法に乱数使用

## 参考文献

- 中川慧 et al. "部分空間正則化付き主成分分析を用いた日米業種リードラグ投資戦略"
- Select Sector SPDR ETFs (State Street)
- TOPIX-17 業種別指数（日本取引所グループ）
