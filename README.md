# 日米業種リードラグ戦略

**学習・検証・ペーパー運用**向けのツールです。部分空間正則化 PCA による日米セクター ETF のリードラグ仮説を、バックテストと Web シグナルで試せます。**利益や元本の保証はありません。** 初心者の方は実弾の前に必ずペーパーを挟んでください。

---

## 🚨 重要なお知らせ（2026-03-28 更新）

### ウォークフォワード検証で戦略の妥当性を確認しました

過去最適化で主張されていた「年率 25%」のパフォーマンスはオーバーフィットでした。パラメータを修正し、厳格なウォークフォワード検証を実施しました。

**全域バックテスト（2018-2025、ルックアヘッド修正後）**

| 戦略 | AR (%) | RISK (%) | R/R | MDD (%) | Total (%) |
|------|--------|----------|-----|---------|-----------|
| MOM | -1.42 | 9.35 | -0.15 | -24.77 | -12.30 |
| PCA PLAIN | 1.77 | 8.81 | 0.20 | -26.31 | 10.25 |
| **PCA SUB** | **2.80** | **8.94** | **0.31** | **-17.77** | **18.50** |

**ウォークフォワード検証（OOS、λ=0.95/Q=0.40）**

| 指標 | In-Sample | Out-of-Sample | Decay |
|------|-----------|---------------|-------|
| 年率リターン | 6.14% | **5.59%** | 0.91 (GOOD) |
| 最大DD | -23.33% | **-14.51%** | 改善 |

**前半/後半スプリット（安定性確認）**

| 期間 | AR (%) | MDD (%) |
|------|--------|---------|
| 前半 (2018-2021) | 4.15% | -16.05% |
| 後半 (2022-2025) | **5.20%** | **-14.51%** |

### 修正内容
1. **パラメータ戻し**: λ=0.80→**0.95**、Q=0.45→**0.40**（全域で安定）
2. **連続損失ルール緩和**: 2日100%撤退→**3日50%縮小**（過剰最適化を回避）
3. **ウォークフォワード検証スクリプト追加**: `node scripts/rigorous_validation.js`

詳細は [FIXES_20260327.md](FIXES_20260327.md) を参照。

---

## 初心者はここだけ（推奨ワークフロー）

| 順番 | やること | コマンド |
|------|----------|----------|
| 0 | **まとめて自動**（毎日向け: doctor 軽量 → ペーパーデモ → CLI シグナル。バックテスト省略） | `npm run workflow` |
| 0b | 初回・設定変更後（データ確認付きバックテストまで） | `npm run workflow:full` |
| 1 | 環境とデータ置き場の確認 | `npm run doctor` |
| 2 | 依存関係のインストール | `npm install` |
| 2b | （Windows）改行を CI と揃える | 推奨: `git config core.autocrlf false`（リポジトリは `.gitattributes` で LF を優先） |
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

## 結果サマリー

**⚠️ 重要：2026 年 3 月 27 日にルックアヘッドバイアスを修正、3 月 28 日に過剰最適化を修正しました**

詳細は [FIXES_20260327.md](FIXES_20260327.md) をご覧ください。

### 修正後（2026 年 3 月 28 日以降、2018-2025 年）

| 戦略 | AR (%) | RISK (%) | R/R | MDD (%) | Total (%) |
|------|--------|----------|-----|---------|-----------|
| MOM | -1.42 | 9.35 | -0.15 | -24.77 | -12.30 |
| PCA PLAIN | 1.77 | 8.81 | 0.20 | -26.31 | 10.25 |
| **PCA SUB** | **2.80** | **8.94** | **0.31** | **-17.77** | **18.50** |

**パラメータ**: λ=0.95, window=60, q=0.4, nFactors=3

### ウォークフォワード検証（OOS, 2026-03-28 実施）

| パラメータ | IS AR (%) | OOS AR (%) | 減衰率 | 判定 |
|-----------|-----------|-----------|--------|------|
| λ=0.95 Q=0.40 | 6.14 | 5.59 | 0.91 | GOOD |
| λ=0.90 Q=0.40 | 6.37 | 5.73 | 0.90 | GOOD |
| λ=0.80 Q=0.45 (旧) | 7.88 | 6.90 | 0.88 | GOOD |
| λ=0.99 Q=0.40 | 6.34 | 5.18 | 0.82 | GOOD |

#### 前半/後半安定性（2018-2022 / 2022-2025）

| パラメータ | 前半 AR | 後半 AR | 安定性 |
|-----------|---------|---------|--------|
| λ=0.95 Q=0.40 | 4.15% | 5.20% | 改善 |
| λ=0.90 Q=0.40 | 4.60% | 4.20% | 安定 |
| λ=0.80 Q=0.45 | 6.71% | 4.58% | 劣化 |

**結論**: λ=0.95 が最も安定。OOS 減衰率 0.91（非常に良好）。実運用目標は年率 3-6%。

### 過去の記録（参考・過大評価の可能性あり）

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
# 例: node src/generate_signal.js --window 60 --lambda 0.95 --quantile 0.4
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
