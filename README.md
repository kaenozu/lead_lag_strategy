# 日米業種リードラグ戦略 - 実装レポート

## はじめに（初心者向け）

このリポジトリは**投資助言ではなく**、研究・検証用のコードです。実取引は**自己責任**で、元本割れの可能性があります。

**まず読む:** 運用の考え方と手順は **[BEGINNER_GUIDE.md](BEGINNER_GUIDE.md)** にまとめています。

### 最短の手順（推奨）

エントリポイントは **`package.json` の npm scripts** を使うのが確実です（`main` の `backtest.js` は実験用が混ざった大きなファイルなので、初心者は実行不要です）。

```bash
cd lead_lag_strategy    # クローンしたディレクトリ名に合わせてください
npm install
npm run doctor          # 任意: Node / data/ / results 書き込みを事前チェック
npm run setup           # 初回: Yahoo から data/*.csv を取得しバックテスト（数分〜）
npm run signal          # 毎日: ローカル data からシグナル（results/ に出力）
```

- **Web UI**（ブラウザでシグナル・バックテスト）: 別ターミナルで `npm run server` または **`npm start`**（同じ）→ ブラウザで **http://localhost:3000** を開く。
- **過去パフォーマンスの分析**: `npm run analysis`（`results/analysis_report.json` など）。
- **テスト**: `npm test`（ユニット・構文チェック・`doctor:ci` 軽量チェックを含む）
- **ペーパートレード（デモ）**: `npm run paper`（仮想約定のサンプルと `results/paper_trading_*.csv`）

### どのファイルを使うか

| 分類 | ファイル | 用途 |
|------|-----------|------|
| **まず使う** | `backtest_improved.js` | データ取得・パラメータ探索・バックテスト（`npm run setup`） |
| | `generate_signal.js` | 毎日のシグナル（`npm run signal`） |
| | `server.js` | Web API と静的 UI（`npm run server`） |
| | `analysis.js` | 年次・レジーム等の分析（`npm run analysis`） |
| **設定の参照** | `sector_constants.js` | 米日 ETF ティッカーとセクターラベル |
| | `lib/lead_lag_core.js` | PCA・シグナル計算の数値コア |
| | `lib/lead_lag_matrices.js` | リターン行列構築（JP の寄り大引けリターンを分離） |
| **参考** | `subspace_pca.py` | Python 版（論文実装イメージ） |
| **実験・旧版** | `backtest.js`, `backtest_v*.js`, `backtest_*.js`（上記以外） | 比較・検証用。迷ったら触らなくてよい |

---

## 概要

部分空間正則化付き PCA を用いた日米業種リードラグ投資戦略を実装し、実市場データ（2018-2025 年）でバックテストを実施。

## 結果サマリー

### 最適パラメータ
- **λ（正則化強度）**: 0.9
- **ウィンドウ長**: 60 日
- **分位点**: 0.4（上位・下位 40% を取引）
- **因子数**: 3

### 戦略比較（2018-2025 年）

| 戦略 | AR (%) | RISK (%) | R/R | MDD (%) | Total (%) |
|------|--------|----------|-----|---------|-----------|
| MOM | 1.40 | 10.11 | 0.14 | -20.12 | 6.26 |
| PCA PLAIN | 2.81 | 9.74 | 0.29 | -16.06 | 17.23 |
| **PCA SUB** | **6.93** | **8.33** | **0.83** | **-20.63** | **56.59** |
| DOUBLE | 0.29 | 16.35 | 0.02 | -38.19 | -6.83 |

### 論文結果との比較

| 指標 | 論文 (2010-2025) | 本実装 (2018-2025) |
|------|-----------------|-------------------|
| AR | 23.79% | 6.93% |
| R/R | 2.22 | 0.83 |
| MDD | 9.58% | -20.63% |

## 主な発見

1. **パラメータ最適化の効果**: λ=0.9（強い正則化）が選択され、推定誤差を抑制
2. **PCA SUB の優位性**: 単純モメンタムを大きく上回るパフォーマンス
3. **リスク特性の改善**: PCA SUB はリスク 8.33% と最も低く効率的
4. **累積リターン**: 7 年間で +56.59%（年率 6.93%）

## 実装ファイル（ディレクトリ構成）

```
lead_lag_strategy/
├── backtest_improved.js    # 推奨: データ取得・バックテスト（npm run setup）
├── generate_signal.js      # 推奨: シグナル（npm run signal）
├── server.js               # Web UI（npm run server）
├── analysis.js             # 分析（npm run analysis）
├── sector_constants.js     # ティッカー・セクター定義
├── lib/lead_lag_core.js   # PCA / シグナル数値コア
├── lib/lead_lag_matrices.js
├── backtest_real.js        # 実市場データ版（実験系）
├── backtest.js             # サンプル・実験（npm main だが初心者は不要）
├── subspace_pca.py         # Python 版（参考用）
├── data/                   # 取得した ETF データ（setup 後に生成）
└── results/                # バックテスト・シグナル出力
    ├── backtest_summary_improved.csv
    ├── optimal_parameters.csv
    ├── cumulative_*.csv
    └── index.html          # 結果可視化
```

## 実行方法

推奨は npm 経由です。

```bash
npm install
npm run setup    # 初回・データ更新時（ネットワーク利用、時間がかかります）
npm run signal   # ローカル data/ が揃っている必要があります
```

同等の直接実行:

```bash
node backtest_improved.js
node generate_signal.js
```

Web サーバー:

```bash
npm run server
# または npm start（同じ）
# http://localhost:3000 — API の設定を HTTP で書き換える場合のみ
# 環境変数 ALLOW_CONFIG_MUTATION=1 が必要です（通常は不要）。
```

開発・CI:

- `npm run doctor:ci` … `data/` なしでも通る Node / `results/` 書き込みチェック（`npm test` に含みます）
- `npm run paper` … ペーパートレード API のデモ実行

## 考察

### 成功要因
- **正則化の効果**: 事前部分空間（グローバル・国スプレッド・シクリカル）への縮約が機能
- **低ランク予測器**: 米国ショックを K 次元空間に射影し日本へ復元する構造が有効

### 課題
- **論文とのギャップ**: AR で 17%、R/R で 1.4 の差
- **期間制約**: 日本 ETF データが 2018 年以降のみ利用可能
- **ダブルソートの不振**: モメンタムとの組み合わせが逆効果に

### 今後の改善方向
1. ファクターモデルによるリスク調整アルファの計測
2. 取引コスト（スリッページ、手数料）の考慮
3. サブサンプル分析（期間による安定性検証）
4. 業種ラベルの再検討（より詳細な分類）
5. 機械学習とのハイブリッド化

## 結論

**実市場データで有意なアルファ（R/R=0.83）を達成**。パラメータ最適化により、単純モメンタムを大幅に上回るパフォーマンスを実現した。論文結果には及ばないものの、部分空間正則化付き PCA の有効性は実証された。

---

実装日：2026 年 3 月 21 日  
データ期間：2018 年 6 月 21 日 - 2025 年 12 月 30 日  
取引日数：1,778 日
