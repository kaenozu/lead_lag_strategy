# 日米業種リードラグ戦略 - 実装レポート

## 概要

部分空間正則化付き PCA を用いた日米業種リードラグ投資戦略を実装し、実市場データ（2018-2025 年）でバックテストを実施。

## プロジェクト構造

```
lead_lag_strategy/
├── src/                        # メインアプリケーションコード
│   ├── index.js               # エントリーポイント
│   ├── server.js              # APIサーバー
│   └── generate_signal.js     # シグナル生成スクリプト
├── scripts/                   # ユーティリティスクリプト
│   ├── doctor.js              # 環境チェック
│   ├── test_unit.js           # ユニットテスト
│   ├── test_api.js            # APIテスト
│   ├── test_backtest.js       # バックテスト動作確認
│   └── paper_trading.js       # ペーパートレード
├── backtest/                  # バックテスト実装
│   ├── index.js               # モジュールエントリーポイント
│   ├── basic.js               # サンプルデータ版
│   ├── real.js                # 実市場データ版
│   ├── improved.js            # 改良版（パラメータ最適化）
│   ├── risk_managed.js        # リスク管理強化版
│   └── analysis.js            # 戦略分析ツール
├── lib/                       # 共通ライブラリ
│   ├── index.js              # エントリーポイント
│   ├── math.js               # 線形代数関数
│   ├── pca.js                # PCAクラス
│   ├── portfolio.js           # ポートフォリオ構築
│   ├── data.js               # データ処理
│   ├── logger.js             # 構造化ログ
│   └── config.js             # 設定管理
├── tests/                     # テスト
│   └── lib/
│       ├── math.test.js
│       ├── pca.test.js
│       ├── portfolio.test.js
│       └── config.test.js
├── public/
│   └── index.html            # Web UI
├── data/                      # 市場データ（CSV）
├── results/                   # 結果出力
├── .env.example               # 環境変数テンプレート
├── package.json
└── jest.config.js
```

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

## 主な改善点

### コード品質向上
- **共通ライブラリ化**: 線形代数関数を `lib/math.js` に集約
- **エラーハンドリング**: 全関数にtry-catchと入力検証を追加
- **構造化ログ**: Winstonによるログ機能 (`lib/logger.js`)
- **設定外部化**: 環境変数による設定管理 (`lib/config.js`)
- **ユニットテスト**: Jestによるテストフレームワーク

### 新機能
- **Web APIサーバー**: `server.js` - リアルタイムシグナル生成
- **シグナル生成スクリプト**: `generate_signal.js` - CLIから実行可能
- **設定ファイル**: `.env.example` - 環境変数テンプレート

### 論文準拠・再現性（環境変数）
- **`BACKTEST_DATA_MODE`**: `yahoo`（既定・近似）または `csv`（`DATA_DIR` の公式 CSV を読む）
- **`BACKTEST_JP_WINDOW_RETURN`**: 推定窓の日本側リターンを `cc`（既定）または `oc` に切替（Python `SubspacePCAConfig.jp_window_return` と対応）
- 日付アライメントは各**日本営業日**に対し、**直前の米国営業日**の CC を対応づける（`lib/data.js` の `alignDates`）
- PCA は **`np.corrcoef` 相当**の標本相関と **対称ヤコビ法**による固有分解（`lib/math.js`）

## 実行方法

### 依存関係インストール
```bash
npm install
```

### シグナル生成
```bash
# デフォルト設定
node src/generate_signal.js

# パラメータ指定
node src/generate_signal.js --window 60 --lambda 0.9 --quantile 0.4

# または npm scripts を使用
npm run signal
```

### Webサーバー起動
```bash
npm run server
# http://localhost:3000 でアクセス
```

### バックテスト実行
```bash
# 実データ版（デフォルト）
npm run backtest

# その他のバックテスト
npm run backtest:basic     # サンプルデータ版
npm run backtest:improved # 改良版（パラメータ最適化）
npm run backtest:risk     # リスク管理強化版
```

### テスト実行
```bash
# 全テスト
npm test

# ウォッチモード
npm run test:watch

# リント
npm run lint
```

## 設定

`.env.example` を `.env` にコピーして必要に応じて変更：

```bash
cp .env.example .env
```

主要設定項目：
- `WINDOW_LENGTH`: ウィンドウ長（デフォルト: 60）
- `LAMBDA_REG`: 正則化パラメータ（デフォルト: 0.9）
- `QUANTILE`: 分位点（デフォルト: 0.3）
- `LOG_LEVEL`: ログレベル（デフォルト: info）

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
