# トラブルシューティングガイド

**最終更新日**: 2026-03-23
**バージョン**: 1.0

---

## 目次

1. [クイックスタート](#クイックスタート)
2. [一般的なエラー](#一般的なエラー)
3. [データ取得の問題](#データ取得の問題)
4. [バックテストのエラー](#バックテストのエラー)
5. [パフォーマンスの問題](#パフォーマンスの問題)
6. [分析ツールの使用](#分析ツールの使用)
7. [FAQ](#faq)

---

## クイックスタート

### 最初のセットアップ

```bash
# 1. 依存関係のインストール
npm install

# 2. 環境チェック
npm run doctor

# 3. 初回バックテスト（データ取得込み）
npm run backtest
```

### 毎日の使用

```bash
# 推奨ワークフロー（自動）
npm run workflow

# 完全ワークフロー（環境チェック＋バックテスト）
npm run workflow:full
```

---

## 一般的なエラー

### エラー 1: `Module not found`

**エラーメッセージ**:
```
Error: Cannot find module 'yahoo-finance2'
```

**原因**: 依存パッケージがインストールされていません。

**解決策**:
```bash
npm install
```

---

### エラー 2: `Data directory not found`

**エラーメッセージ**:
```
Error: ENOENT: no such file or directory, scandir '.../data'
```

**原因**: データディレクトリが存在しません。

**解決策**:
```bash
# 自動的に作成されますが、手動作成も可能
mkdir -p data
mkdir -p results
```

---

### エラー 3: `Yahoo Finance API rate limit`

**エラーメッセージ**:
```
Error: Too Many Requests
```

**原因**: Yahoo Finance のレート制限に達しました。

**解決策**:
1. 数分待ってから再試行
2. ローカル CSV データを使用
3. 環境変数でキャッシュを設定

```bash
# .env に追加
YAHOO_FINANCE_CACHE_TTL=3600
```

---

### エラー 4: `Insufficient data`

**エラーメッセージ**:
```
エラー：データ不足
  取引日数が 100 日未満です
```

**原因**: データ期間が短すぎます。

**解決策**:
```bash
# 期間を拡張
# .env または config ファイルで START_DATE を変更
START_DATE=2018-01-01
```

---

## データ取得の問題

### 問題 1: 日本 ETF データが取得できない

**症状**: 特定の日本 ETF のデータが空

**考えられる原因**:
1. ティッカーが正しくない
2. 上場前のデータを取得しようとしている
3. 廃止された ETF

**解決策**:
```bash
# 1. ティッカーを確認
# lib/constants.js で JP_ETF_TICKERS を確認

# 2. 上場日を確認
# Yahoo Finance で個別に検索

# 3. 代替ティッカーを使用
# 例：1617.T → 1617.T8316
```

---

### 問題 2: 米国 ETF データが古い

**症状**: 最新のデータが取得できない

**考えられる原因**:
1. 市場が閉まっている（休日）
2. データプロバイダーの遅延
3. キャッシュの問題

**解決策**:
```bash
# 1. 市場カレンダーを確認
# 米国市場の休日：https://www.nyse.com/markets/hours-calendars

# 2. キャッシュをクリア
rm -rf data/*.csv
npm run backtest

# 3. 手動でデータ更新
node scripts/fetch_data.js --force
```

---

### 問題 3: データの整合性エラー

**症状**: 日付アライメントエラー

**解決策**:
```javascript
// lib/data/alignment.js の動作を確認
// 米国市場の休日は日本市場の営業日に対応しない

// 解決策：アライメントモードを変更
// .env に追加
ALIGNMENT_MODE=strict  # strict または legacy
```

---

## バックテストのエラー

### エラー 1: `Matrix is singular`

**エラーメッセージ**:
```
Error: Matrix is singular or nearly singular
```

**原因**: 相関行列の計算で数値的不安定性

**解決策**:
```javascript
// 1. 正則化パラメータを調整
// .env または config で lambdaReg を増加
LAMBDA_REG=0.95  # デフォルト 0.9

// 2. ウィンドウ長を短く
WINDOW_LENGTH=40  # デフォルト 60

// 3. 因子数を減らす
N_FACTORS=2  # デフォルト 3
```

---

### エラー 2: `Negative weights`

**症状**: ポートフォリオウェイトが異常

**原因**: 分位点パラメータの設定

**解決策**:
```bash
# quantile パラメータを調整
QUANTILE=0.3  # デフォルト 0.4
# 0.2-0.5 の範囲で調整
```

---

### エラー 3: 結果が NaN または Infinity

**原因**: 数値的发散

**解決策**:
```bash
# 1. データに欠損値がないか確認
npm run doctor

# 2. 外れ値を除去
# lib/math.js の標準化処理を確認

# 3. 正則化を強化
LAMBDA_REG=0.99
```

---

## パフォーマンスの問題

### 問題 1: バックテストが遅い

**症状**: 完了までに 10 分以上かかる

**解決策**:
```bash
# 1. グリッドサーチを簡略化
# backtest/improved.js の PARAM_GRID を縮小

# 2. ウィンドウ長を短く
WINDOW_LENGTH=40

# 3. サンプル期間を短く
START_DATE=2020-01-01
```

---

### 問題 2: メモリ不足

**エラーメッセージ**:
```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

**解決策**:
```bash
# Node.js のメモリ制限を増加
export NODE_OPTIONS="--max-old-space-size=4096"
npm run backtest
```

---

## 分析ツールの使用

### シグナル精度分析

```bash
# US→JP 予測精度を分析
npm run analysis:signal

# 出力:
# - results/signal_accuracy_report.json
# - results/signal_accuracy_by_sector.csv
# - results/signal_accuracy_monthly.csv
```

**結果の解釈**:
- **Direction Accuracy > 55%**: 良好
- **Direction Accuracy 50-55%**: 偶然レベル
- **Direction Accuracy < 50%**: 要改善

---

### 取引コスト感応度分析

```bash
# 取引コストの影響を分析
npm run analysis:cost

# 出力:
# - results/transaction_cost_sensitivity.csv
# - results/break_even_cost.json
```

**結果の解釈**:
- **Break-even Cost > 0.15%**: 実用的
- **Break-even Cost 0.05-0.15%**: 標準的
- **Break-even Cost < 0.05%**: 要改善

---

### サブサンプル分析

```bash
# 市場レジーム別パフォーマンス
npm run analysis:subsample

# 出力:
# - results/subsample_analysis.csv
# - results/rolling_window_analysis.csv
# - results/subsample_summary.json
```

**結果の解釈**:
- **安定性スコア > 75%**: 高い安定性
- **安定性スコア 50-75%**: 中程度
- **安定性スコア < 50%**: 低い

---

### ファクターモデル分析

```bash
# Fama-French ファクターエクスポージャー
npm run analysis:factor

# 出力:
# - results/factor_model_analysis.csv
# - results/factor_model_summary.json
```

**結果の解釈**:
- **Alpha t-Stat > 2**: 統計的に有意
- **R-squared < 0.3**: ファクターでは説明できないリターン
- **Market Beta < 0.3**: マーケットニュートラル

---

## FAQ

### Q1: 最適なパラメータは何ですか？

**A**: データ期間と市場環境に依存します。デフォルトは論文推奨値です：

```bash
WINDOW_LENGTH=60
LAMBDA_REG=0.9
N_FACTORS=3
QUANTILE=0.4
```

最適化には `npm run backtest:improved` を使用してください。

---

### Q2: なぜ PCA SUB のパフォーマンスが論文より低いのですか？

**A**: 主な理由はデータ期間の制約です：

- **論文**: 2010-2025 年（16 年）
- **本実装**: 2018-2025 年（7 年）

2010-2018 年のアベノミクス期が欠落しています。

---

### Q3: 実弾運用は可能ですか？

**A**: 本プロジェクトは**学習・検証目的**です。実弾運用の前に：

1. 十分なペーパートレード検証
2. 取引コストの精密な見積もり
3. リスク管理システムの構築
4. 法的・規制上の確認

を推奨します。

---

### Q4: データソースを変更できますか？

**A**: はい、可能です：

```bash
# .env または config/runtime-data-source.json
JP_DATA_SOURCE=yahoo    # yahoo, jquants, csv
US_DATA_SOURCE=yahoo    # yahoo, alphavantage, csv
```

---

### Q5: 日本 ETF のデータ取得方法

**A**: 以下のソースが利用可能です：

1. **Yahoo Finance**（デフォルト）
   - 無料
   - 2018 年以降のデータ

2. **J-Quants**（要登録）
   - 無料（要 API キー）
   - より長い歴史データ

3. **ローカル CSV**
   - 任意のソースから取得

---

### Q6: エラーログの場所

**A**: ログは以下に出力されます：

```bash
# アプリケーションログ
logs/app.log

# エラーログ
logs/error.log

# バックテストログ
logs/backtest.log
```

---

### Q7: テストの実行方法

**A**: 以下のコマンドでテストを実行：

```bash
# 全テスト
npm test

# 単体テスト
npm run test:unit

# E2E テスト
npm run test:e2e

# リント
npm run lint
```

---

### Q8: 結果の可視化

**A**: Web UI を使用：

```bash
# サーバー起動
npm run server

# ブラウザでアクセス
http://localhost:3000
```

---

## 追加リソース

### 内部ドキュメント

- [README.md](./README.md) - プロジェクト概要
- [BEGINNER_GUIDE.md](./BEGINNER_GUIDE.md) - 初心者ガイド
- [PAPER_VERIFICATION_REPORT_EN.md](./PAPER_VERIFICATION_REPORT_EN.md) - 論文検証レポート

### 外部リソース

- [Yahoo Finance](https://finance.yahoo.com/)
- [J-Quants](https://j-quants.jp/)
- [Fama-French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html)

---

## サポート

問題が解決しない場合は：

1. エラーメッセージを記録
2. 実行したコマンドを記録
3. 環境情報（Node.js バージョン、OS など）を記録
4. GitHub Issues で報告

---

**最終更新日**: 2026-03-23
**バージョン**: 1.0
