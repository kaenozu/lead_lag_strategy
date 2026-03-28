# Lead-Lag Strategy Skills

プロジェクト専用のスキル定義ディレクトリ

## 使用方法

各スキルは以下のコマンドで実行できます：

```bash
# スキル一覧
npm run skill:list

# バックテストスキル実行
npm run skill:backtest

# シグナル生成スキル
npm run skill:signal

# リスク管理スキル
npm run skill:risk

# パフォーマンス分析スキル
npm run skill:performance

# データ検証スキル
npm run skill:validate

# フルワークフロースキル
npm run skill:full
```

## スキル一覧

| スキル | 説明 | 実行時間 |
|--------|------|----------|
| `backtest` | パラメータ最適化バックテスト | 5-10 分 |
| `signal` | 最新データでのシグナル生成 | 30 秒 |
| `risk` | リスク管理とポジションサイジング | 1 分 |
| `performance` | パフォーマンス詳細分析 | 2 分 |
| `validate` | データ完全性検証 | 1 分 |
| `report` | 取引レポート生成 | 30 秒 |
| `full` | 全スキル連続実行 | 15 分 |

## 各スキルの詳細

### 1. backtest.js
- パラメータグリッドサーチ
- ウォークフォワード分析
- 感応度分析

### 2. signal.js
- 最新市場データ取得
- PCA シグナル計算
- 銘柄ランキング生成

### 3. risk.js
- ボラティリティ調整
- 相関リスク評価
- ポジションサイズ計算

### 4. performance.js
- 年率リターン・リスク計算
- 最大ドローダウン分析
- シャープレシオ・ソルティノレシオ

### 5. validate.js
- データソース完全性チェック
- 欠損値・異常値検出
- 価格整合性検証

### 6. report.js
- 日次/月次レポート生成
- 取引サマリー
- リスクエクスポージャー

## カスタムスキル作成

新しいスキルを作成するには：

```javascript
// skills/my-skill.js
const { createSkill } = require('./skill-base');

module.exports = createSkill({
  name: 'my-skill',
  description: 'スキルの説明',
  run: async (config) => {
    // スキル実装
    return { success: true, data: {} };
  }
});
```

## 出力先

- **結果ファイル:** `results/skills/`
- **ログファイル:** `logs/skills/`
- **レポート:** `reports/`
