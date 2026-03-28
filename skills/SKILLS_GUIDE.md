# リードラグ戦略スキルガイド

## 概要

日米業種リードラグ投資戦略のための専用スキルシステムです。各スキルは特定のタスクに特化し、単独または組み合わせて実行できます。

---

## クイックスタート

```bash
# スキル一覧表示
npm run skill:list

# 個別スキル実行
npm run skill:signal        # シグナル生成
npm run skill:risk          # リスク管理
npm run skill:validate      # データ検証

# 全スキル連続実行
npm run skill:full
```

---

## スキル一覧

### 1. backtest - パラメータ最適化バックテスト

**説明:** 部分空間正則化 PCA のパラメータを最適化し、ウォークフォワード分析を実行

**実行:**
```bash
npm run skill:backtest
```

**出力:**
- 最適パラメータ（windowLength, lambdaReg, quantile, nFactors）
- パフォーマンスメトリクス
- パラメータ感応度
- ウォークフォワード分析結果

**デフォルト設定:**
```javascript
{
  windowLength: [40, 60, 80],      // 最適化候補
  lambdaReg: [0.7, 0.8, 0.9],      // 正則化強度
  quantile: [0.3, 0.4, 0.5],       // 分位点
  nFactors: [2, 3, 4],             // 因子数
  startDate: '2018-01-01',
  endDate: '2026-03-28',
  transactionCost: 0.001           // 0.1%
}
```

**実行時間:** 5-10 分

---

### 2. signal - 取引シグナル生成

**説明:** 最新市場データからロング・ショート銘柄を生成

**実行:**
```bash
npm run skill:signal
```

**出力:**
- 日本 17 業種のシグナル値
- ランキング（ロング候補・ショート候補）
- 推奨ポジションウェイト
- シグナル統計量（平均、標準偏差、Min/Max）

**デフォルト設定:**
```javascript
{
  windowLength: 60,        // 推定ウィンドウ
  nFactors: 3,             // 因子数
  lambdaReg: 0.9,          // 正則化強度
  lookbackDays: 120,       // データ取得期間
  quantile: 0.4            // 上位・下位 40% を取引
}
```

**出力例:**
```json
{
  "rankings": {
    "long": [
      { "ticker": "1617.T", "signal": 0.85, "weight": 0.143 },
      { "ticker": "1618.T", "signal": 0.72, "weight": 0.143 }
    ],
    "short": [
      { "ticker": "1633.T", "signal": -0.91, "weight": -0.143 },
      { "ticker": "1632.T", "signal": -0.78, "weight": -0.143 }
    ]
  }
}
```

**実行時間:** 30 秒

---

### 3. risk - リスク管理

**説明:** ポートフォリオのリスクメトリクスを計算し、ポジション制限を設定

**実行:**
```bash
npm run skill:risk
```

**出力:**
- ボラティリティ（銘柄別・平均）
- 相関行列
- VaR (Value at Risk)
- 期待ショートフォール
- 推奨ポジションサイズ

**デフォルト設定:**
```javascript
{
  lookbackDays: 252,           // 1 年
  confidenceLevel: 0.95,       // 95% VaR
  targetVolatility: 0.10,      // 年率 10%
  maxPositionSize: 0.20,       // 単一銘柄最大 20%
  maxGrossExposure: 2.0,       // 最大グロス 200%
  maxNetExposure: 0.5          // 最大ネット 50%
}
```

**主要メトリクス:**
- **VaR(95%):** 95% 信頼区間での最大予想損失
- **期待ショートフォール:** VaR 超過時の平均損失
- **ボラティリティスケーリング:** ターゲットボラティリティに基づくポジション調整係数

**実行時間:** 1 分

---

### 4. performance - パフォーマンス分析

**説明:** 詳細なパフォーマンス分析とアトリビューション

**実行:**
```bash
npm run skill:performance
```

**出力:**
- 年率リターン・リスク・シャープレシオ
- 年別リターン
- ドローダウン分析
- ローリングメトリクス
- ロング・ショート別アトリビューション

**デフォルト設定:**
```javascript
{
  startDate: '2018-01-01',
  windowLength: 60,
  lambdaReg: 0.9,
  quantile: 0.4,
  nFactors: 3,
  transactionCost: 0.001,
  includeAttribution: true,
  includeRollingMetrics: true,
  rollingWindow: 63          // 3 ヶ月
}
```

**主要メトリクス:**
- **シャープレシオ:** リスク調整後リターン
- **カルマーレシオ:** リターン / 最大ドローダウン
- **勝率:** 勝ちトレードの割合
- **プロフィットファクター:** 総利益 / 総損失

**実行時間:** 2 分

---

### 5. validate - データ検証

**説明:** 市場データの完全性と品質を検証

**実行:**
```bash
npm run skill:validate
```

**出力:**
- データ存在チェック
- 価格妥当性検証
- リターン異常値検出
- 欠損日チェック
- 相関チェック

**デフォルト設定:**
```javascript
{
  lookbackDays: 252,
  checks: {
    missingData: true,
    priceValidity: true,
    returnAnomalies: true,
    correlationCheck: true
  },
  thresholds: {
    maxMissingDays: 10,
    maxReturnAnomaly: 0.20,   // 20%
    minCorrelation: -0.95,
    maxCorrelation: 0.99
  }
}
```

**検証項目:**
1. **MISSING_DATA:** データが存在しない
2. **INSUFFICIENT_DATA:** データが不足
3. **INVALID_PRICE:** 価格が不正（0 以下）
4. **OHLC_INVALID:** 始末高安の整合性
5. **RETURN_ANOMALY:** 異常リターン（±20% 超）
6. **EXCESSIVE_GAPS:** 欠損日過多

**ステータス:**
- `OK:` すべてのチェックに合格
- `WARNING:` 警告あり（データ利用可能）
- `ERROR:` エラーあり（データ見直し必要）

**実行時間:** 1 分

---

### 6. report - レポート生成

**説明:** 取引レポートとサマリーを生成

**実行:**
```bash
npm run skill:report
```

**出力:**
- エグゼクティブサマリー
- ポジションサマリー
- パフォーマンスサマリー
- リスクメトリクス
- 取引履歴

**デフォルト設定:**
```javascript
{
  reportType: 'daily',       // daily, weekly, monthly
  format: 'json',            // json, markdown, html
  outputDir: './reports'
}
```

**フォーマット:**
- **JSON:** 機械可読形式
- **Markdown:** 人間可読形式（推奨）
- **HTML:** Web 表示用

**実行時間:** 30 秒

---

## 組み合わせ使用例

### 朝のルーチン（取引前）

```bash
# 1. データ検証
npm run skill:validate

# 2. シグナル生成
npm run skill:signal

# 3. リスクチェック
npm run skill:risk

# 4. レポート生成
npm run skill:report -- --reportType=daily --format=markdown
```

### 夜間バッチ（分析）

```bash
# 全スキル実行（約 15 分）
npm run skill:full

# または個別に
npm run skill:backtest && npm run skill:performance
```

### 週次レビュー

```bash
# 週次レポート生成
npm run skill:report -- --reportType=weekly

# パフォーマンス詳細分析
npm run skill:performance -- --includeRollingMetrics=true
```

---

## カスタマイズ

### 設定上書き

```bash
# コマンドライン引数
npm run skill:signal -- --windowLength=80 --nFactors=4

# 環境変数
export SKILL_WINDOW_LENGTH=80
export SKILL_N_FACTORS=4
npm run skill:signal
```

### 独自スキル作成

```javascript
// skills/my-skill.js
const { createSkill } = require('./skill-base');

module.exports = createSkill({
  name: 'my-skill',
  description: 'カスタムスキル',
  defaultConfig: {
    param1: 'value1'
  },
  run: async (config) => {
    // 実装
    return { result: 'success' };
  }
});
```

---

## 出力先

| 種類 | ディレクトリ | 説明 |
|------|-------------|------|
| 結果 | `results/skills/` | 各スキールの生結果 |
| ログ | `logs/skills/` | エラーログ |
| レポート | `reports/` | 生成レポート |

---

## トラブルシューティング

### スキルが実行されない

```bash
# 構文チェック
node --check skills/index.js

# 依存関係確認
npm install
```

### データ取得エラー

```bash
# データソース確認
npm run parity:data

# 手動データ取得テスト
node -e "require('./lib/data').fetchOhlcvForTickers(['XLK'], 60, require('./lib/config')).then(console.log)"
```

### メモリ不足エラー

```bash
# ノードメモリ増加
export NODE_OPTIONS="--max-old-space-size=4096"
npm run skill:backtest
```

---

## ベストプラクティス

1. **朝の検証:** 毎日 `validate` → `signal` → `risk` の順で実行
2. **週次最適化:** 週 1 回 `backtest` でパラメータ再検証
3. **月次レポート:** 月末に `performance` + `report` で包括分析
4. **結果保存:** すべての実行結果を `results/` に保存し、経時変化を追跡
5. **エラー監視:** `logs/skills/` のエラーログを定期的に確認

---

## パフォーマンス目安

| スキル | 実行時間 | メモリ使用量 |
|--------|---------|-------------|
| backtest | 5-10 分 | 500MB |
| signal | 30 秒 | 200MB |
| risk | 1 分 | 300MB |
| performance | 2 分 | 400MB |
| validate | 1 分 | 200MB |
| report | 30 秒 | 100MB |

---

## 関連ドキュメント

- [CLAUDE.md](../CLAUDE.md) - プロジェクト全体設定
- [CLAUDE_WORKFLOW.md](../CLAUDE_WORKFLOW.md) - 開発ワークフロー
- [BEGINNER_GUIDE.md](../BEGINNER_GUIDE.md) - 初心者ガイド
- [QWEN.md](../QWEN.md) - 技術詳細

---

## サポート

問題が発生した場合は：

1. エラーログを確認: `logs/skills/`
2. データ検証を実行: `npm run skill:validate`
3. ドキュメント参照: [CLAUDE_WORKFLOW.md](../CLAUDE_WORKFLOW.md)
4. GitHub Issues で報告
