# 日米業種リードラグ戦略

**学習・検証・ペーパー運用**向けのツールです。部分空間正則化 PCA による日米セクター ETF のリードラグ仮説を、バックテストと Web シグナルで試せます。**利益や元本の保証はありません。** 初心者の方は実弾の前に必ずペーパーを挟んでください。

---

## 🚨 重要なお知らせ（2026-03-27 更新）

### 戦略改善により損失を大幅に抑制しました

過去 1 ヶ月（2026-02-27 〜 2026-03-27）の実績：

| 指標 | 改善前 | **改善後** | 改善 |
|------|--------|-----------|------|
| 総損益 | -65,144 円 | **-7,461 円** | **+57,683 円** |
| 勝率 | 38.7% | **50.0%** | **+11.3%** |
| 最大 DD | -9.69% | **-1.36%** | **+8.33%** |

### 改善策（4 つ）
1. **パラメータ最適化**: lambdaReg=0.7, nFactors=1, quantile=0.6
2. **日次損失ストップ**: -2% でポジション解消
3. **セクターフィルタ**: 成績不良 5 銘柄を除外（1622.T, 1624.T, 1625.T, 1626.T, 1633.T）
4. **ボラティリティ調整**: 高ボラ日はポジション 50% 縮小

### 改善版の実行方法
```bash
# 改善版バックテスト（推奨）
node scripts/backtest_improved.js

# 改善版実利益計算
node scripts/calculate_real_profit_improved.js

# パラメータ最適化（グリッドサーチ）
node scripts/optimize_parameters.js
```

詳細は [docs/decisions/ADR-007_戦略改善策の導入.md](docs/decisions/ADR-007_戦略改善策の導入.md) を参照。

---

## 初心者はここだけ（推奨ワークフロー）

| 順番 | やること | コマンド |
|------|----------|----------|
| 0 | **まとめて自動**（毎日向け: doctor 軽量 → ペーパーデモ → CLI シグナル。バックテスト省略） | `npm run workflow` |
| 0b | 初回・設定変更後（データ確認付きバックテストまで） | `npm run workflow:full` |
| 1 | 環境とデータ置き場の確認 | `npm run doctor` |
| 2 | 依存関係のインストール | `npm install` |
| 3 | （任意）`.env` を用意 | `cp .env.example .env` |
| 4 | **本番相当のバックテスト 1 本**（論文デフォルト寄りの設定は `lib/config.js` / `.env`） | `npm run backtest` → [backtest/real.js](backtest/real.js) |
| 5 | **実弾前の必須ステップ**：ペーパーで挙動確認 | `npm run paper`（[scripts/paper_trading.js](scripts/paper_trading.js)） |
| 6 | ブラウザでシグナル確認（任意） | `npm run server` → http://localhost:3000 |

週次で結果を見直し、ルールに合わないときは一時停止する運用を推奨します。

**`npm run workflow`:** 任意のまとめ実行です。画面での読み方は **Web の「表の見方と、買ったあとの流れ（開いて読む）」** を参照してください。

---

## 主系スタック（Node）

- **計算・API・Web UI の中心**は **Node.js**（[lib/](lib/)・[src/server.js](src/server.js)）です。
- **[subspace_pca.py](subspace_pca.py)** / **[backtest.py](backtest.py)** は **任意の検証・研究用**（同じ思想の Python 実装）。日常の推奨フローでは必須ではありません。

---

## 上級者・実験用スクリプト

| コマンド / ファイル | 用途 |
|---------------------|------|
| `npm run backtest:basic` | [backtest/basic.js](backtest/basic.js) サンプルデータ |
| `npm run backtest:improved` | [backtest/improved.js](backtest/improved.js) パラメータグリッド探索 |
| `npm run backtest:risk` | [backtest/risk_managed.js](backtest/risk_managed.js) リスク管理実験版 |
| `npm run analysis` | [backtest/analysis.js](backtest/analysis.js) 分析ツール |
| `npm run signal` | [src/generate_signal.js](src/generate_signal.js) CLI シグナル |
| Python `backtest.py` | 上記と別経路の検証 |

---

## 免責・API

- 画面上部に固定のリスク説明を表示しています（[public/index.html](public/index.html)）。
- JSON API には `disclosure` フィールド（短文＋箇条書き）を付与しています。専用エンドポイント: `GET /api/disclosure`。

---

## ドキュメント案内

- 入口: `docs/INDEX.md`
- 初学者向け: `BEGINNER_GUIDE.md`
- 品質ゲート: `docs/TESTING.md`

---

## 概要（技術）

部分空間正則化付き PCA を用いた日米業種リードラグ投資戦略の実装。実市場データでのバックテスト・シグナル生成が可能です。

## プロジェクト構造

```
lead_lag_strategy/
├── src/                        # メインアプリケーションコード
│   ├── server.js              # APIサーバー
│   └── generate_signal.js     # シグナル生成スクリプト
├── scripts/                   # ユーティリティスクリプト
│   ├── doctor.js              # 環境チェック
│   ├── paper_trading.js       # ペーパートレード（推奨）
│   └── ...
├── backtest/                  # バックテスト実装（real が推奨の 1 本）
├── lib/                       # 共通ライブラリ（disclosure.js 含む）
├── public/                    # Web UI
├── docs/
│   └── TESTING.md             # テスト・品質ゲート
├── subspace_pca.py            # 任意：Python モジュール
├── backtest.py                # 任意：Python バックテスト
└── ...
```

## 結果サマリー（参考・過去記録）

**⚠️ 重要：2026 年 3 月 27 日にルックアヘッドバイアスを修正しました**

詳細は [FIXES_20260327.md](FIXES_20260327.md) をご覧ください。

### 修正後（2026 年 3 月 27 日以降、2018-2025 年）

| 戦略 | AR (%) | RISK (%) | R/R | MDD (%) | Total (%) |
|------|--------|----------|-----|---------|-----------|
| MOM | -1.42 | 9.35 | -0.15 | -24.77 | -12.30 |
| PCA PLAIN | 1.37 | 8.84 | 0.15 | -24.15 | 7.17 |
| **PCA SUB** | **3.22** | **8.93** | **0.36** | **-20.10** | **22.11** |
| DOUBLE | 1.00 | 13.96 | 0.07 | -41.63 | 0.21 |

**最適パラメータ（修正後）**: λ=0.95, window=60, q=0.4, nFactors=3

### 修正前（参考・過大評価の可能性あり）

| 戦略 | AR (%) | RISK (%) | R/R | MDD (%) | Total (%) |
|------|--------|----------|-----|---------|-----------|
| PCA SUB（旧） | 6.93 | 8.33 | 0.83 | -20.63 | 56.59 |

過去の実行例は環境・期間により変動します。最新は `npm run backtest` で確認してください。

## 主な機能

- **Web APIサーバー**: バックテスト・シグナル・免責テキスト
- **設定**: 環境変数（[.env.example](.env.example)）に加え、**データ取得モード**は Web 画面または `config/runtime-data-source.json`（例: [config/runtime-data-source.json.example](config/runtime-data-source.json.example)）
- **論文準拠オプション**: `BACKTEST_JP_WINDOW_RETURN` など（詳細は下記）

### 論文準拠・再現性（環境変数）

- **データ取得モード（日本 `yahoo` / `jquants` / `csv`、米国 `yahoo` / `alphavantage`）**: Web の「データ取得」欄で変更するか、`config/runtime-data-source.json` を編集（API キーは `.env`）
- **`BACKTEST_JP_WINDOW_RETURN`**: 推定窓の日本側リターン `cc`（既定）または `oc`
- 日付アライメント: 各日本営業日に直前の米国営業日の CC を対応（`lib/data/alignment.js`）
- PCA: 標本相関に近い定義と対称ヤコビ法による固有分解（`lib/math.js`）

## 実行方法（詳細）

### 依存関係インストール

```bash
npm install
```

### シグナル生成（CLI）

```bash
npm run signal
# 例: node src/generate_signal.js --window 60 --lambda 0.9 --quantile 0.4
```

### Webサーバー起動

```bash
npm run server
# http://localhost:3000
```

### バックテスト

```bash
npm run backtest          # 推奨（real）
npm run backtest:basic    # 上級者：サンプル
npm run backtest:improved # 上級者：パラメータ探索
npm run backtest:risk     # 上級者：リスク管理版
```

### テスト

```bash
npm test
```

品質ゲートの説明は [docs/TESTING.md](docs/TESTING.md) を参照してください。

```bash
npm run test:watch
npm run lint
```

## 設定

`.env.example` を `.env` にコピーして必要に応じて変更：

```bash
cp .env.example .env
```

主要項目: `WINDOW_LENGTH`, `LAMBDA_REG`, `QUANTILE`, `BACKTEST_SLIPPAGE` / `BACKTEST_COMMISSION`（0＝無摩擦・論文寄り）、`START_DATE` など。

## 考察・課題（参考）

- 正則化 PCA とリードラグ構造の学習価値
- 論文 Table 2 との数値一致はデータソース・期間次第
- 日本 ETF の取得可能期間による制約
- ダブルソートは環境により不安定になりうる

---

データ期間・取引日数は実行時ログおよび `results/` を参照してください。
