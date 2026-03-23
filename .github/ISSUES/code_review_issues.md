# 【コードレビュー】全ソースコードレビューで発見された課題

**作成日**: 2026-03-23  
**優先度**: 高  
**ラベル**: `bug`, `security`, `enhancement`, `tests`, `performance`

---

## 概要

全ソースコードをレビューした結果、以下の課題が発見されました。本イシューでは、優先度順に各課題を整理し、修正方針を提案します。

---

## 🔴 高優先度（本番展開前に修正必須）

### 1. セキュリティ：API エンドポイントの認証・認可缺失

**場所**: `server.js`  
**影響**: 全ての API エンドポイント（`/api/backtest`, `/api/signal`）が無認証でアクセス可能。悪意あるリソース消費攻撃（DoS）のリスク。

#### 修正方針

簡易 API キー認証を実装：

```javascript
// server.js - 冒頭に追加
const API_KEY = process.env.API_KEY;

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// 適用例
app.use('/api/backtest', apiKeyAuth, backtestLimiter);
app.use('/api/signal', apiKeyAuth, apiLimiter);
```

**関連ファイル**: `.env.example`（API_KEY 追加）  
**推定工数**: 2-3 時間

---

### 2. エラーハンドリング：未処理の Promise リジェクション

**場所**: `backtest_real.js`, `backtest_improved.js`, `generate_signal.js`  
**影響**: 予期せぬエラー発生時に原因特定が困難

#### 修正方針

詳細なエラーログ出力と適切な終了コードの設定：

```javascript
main().catch(error => {
  logger.error('Backtest failed', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  const exitCode = error.code === 'INSUFFICIENT_DATA' ? 2 : 1;
  process.exit(exitCode);
});
```

**推定工数**: 1-2 時間

---

### 3. 入力検証：API パラメータのサニタイズ不足

**場所**: `server.js` - `validateBacktestParams()`  
**影響**: 境界値攻撃や型変換の悪用の可能性

#### 修正方針

型チェックの強化：

```javascript
function validateBacktestParams(body) {
  const errors = [];
  const params = {};

  if (typeof body.windowLength !== 'string' && typeof body.windowLength !== 'number') {
    errors.push('windowLength must be a number');
  } else {
    const val = parseInt(String(body.windowLength).trim(), 10);
    if (isNaN(val) || val < 10 || val > 500) {
      errors.push('windowLength must be between 10 and 500');
    } else {
      params.windowLength = val;
    }
  }
  // ...
}
```

**推定工数**: 2 時間

---

## 🟡 中優先度（改善推奨）

### 4. パフォーマンス：バックテストループの最適化余地

**場所**: `backtest_real.js`, `backtest_improved.js`  
**影響**: 計算量が O(n²) で長期バックテストで実行時間が増大（現在 10 分程度）

#### 修正方針

スライディングウィンドウの最適化（O(1) 更新）：

```javascript
let retUsWin = retUs.slice(0, config.windowLength).map(r => r.values);
let retJpWin = retJp.slice(0, config.windowLength).map(r => r.values);

for (let i = config.warmupPeriod; i < dates.length; i++) {
  if (i > config.warmupPeriod) {
    retUsWin.shift();
    retUsWin.push(retUs[i - 1].values);
    retJpWin.shift();
    retJpWin.push(retJp[i - 1].values);
  }
  // ...
}
```

**推定工数**: 4-6 時間

---

### 5. メモリリーク：logger のトランスポート設定

**場所**: `lib/logger.js`  
**影響**: 長期稼働でディスク容量を圧迫する可能性

#### 修正方針

DailyRotateFile の使用：

```javascript
const DailyRotateFile = require('winston-daily-rotate-file');

transports.push(
  new DailyRotateFile({
    filename: LOG_FILE,
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '7d',
    format: customFormat,
    level: LOG_LEVEL
  })
);
```

**推定工数**: 1-2 時間

---

### 6. テストカバレッジ：ユニットテストの不足

**場所**: `tests/`  
**影響**: リファクタリング時の回帰テストが困難

#### 修正方針

Jest を使用したユニットテストの拡充：

```javascript
// tests/lib/pca.test.js
const { SubspaceRegularizedPCA, LeadLagSignal } = require('../../lib/pca');

describe('SubspaceRegularizedPCA', () => {
  describe('buildPriorSpace', () => {
    test('事前部分空間が正規直交系をなす', () => {
      const pca = new SubspaceRegularizedPCA({ lambdaReg: 0.9, nFactors: 3 });
      const CFull = createTestCorrelationMatrix();
      pca.buildPriorSpace(11, 17, SECTOR_LABELS, CFull);
      
      const V0 = pca.V0;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const dot = V0.reduce((sum, row) => sum + row[i] * row[j], 0);
          expect(dot).toBeCloseTo(i === j ? 1 : 0, 5);
        }
      }
    });
  });
});
```

**推定工数**: 8-16 時間

---

### 7. 依存関係：yahoo-finance2 のバージョン固定

**場所**: `package.json`  
**影響**: `npm install` で予期せぬ動作変更が発生するリスク

#### 修正方針

正確なバージョン固定：

```json
{
  "dependencies": {
    "yahoo-finance2": "3.13.2",
    "express": "5.2.1",
    "axios": "1.13.6"
  }
}
```

**推定工数**: 30 分

---

## 🟢 低優先度（任意改善）

### 8. コード構造：マジックナンバーの定数化

**場所**: 複数ファイル  
**修正方針**: `lib/constants.js` に定数を集約

### 9. 命名規則：一貫性の欠如

**場所**: 複数ファイル  
**修正方針**: 命名規則ガイドラインの策定と適用

### 10. ドキュメント：JSDoc の充実

**場所**: `lib/` 配下の関数  
**修正方針**: 主要関数に JSDoc コメントを追加

### 11. Python コード：型ヒントの強化

**場所**: `subspace_pca.py`, `backtest.py`  
**修正方針**: `typing` モジュールを使用した型ヒントの追加

### 12. CI/CD：GitHub Actions の整備

**場所**: `.github/workflows/`  
**修正方針**: テスト・Lint・ビルドの自動化

---

## 総括

### 即時対応が必要な問題（本番展開前）

| 優先度 | 問題 | 推定工数 |
|--------|------|----------|
| 🔴 高 | API 認証の実装 | 2-3 時間 |
| 🔴 高 | エラーハンドリングの改善 | 1-2 時間 |
| 🟡 中 | 入力検証の強化 | 2 時間 |

### 中長期的な改善

| 優先度 | 問題 | 推定工数 |
|--------|------|----------|
| 🟡 中 | ユニットテストの拡充 | 8-16 時間 |
| 🟡 中 | パフォーマンス最適化 | 4-6 時間 |
| 🟢 低 | CI/CD パイプライン整備 | 4 時間 |
| 🟢 低 | JSDoc の充実 | 4-8 時間 |

### 総合評価

🟢 **良好**（学術研究用途としては十分、本番運用には一部改善が必要）

コードの品質は全体的に高く、数値計算の実装は特に優れています。セキュリティとテストカバレッジの改善により、本番環境での運用も可能になります。

---

## 参考

- レビュー実施日：2026-03-23
- レビュー対象ファイル数：約 40 ファイル
- レビュー基準：正確性、セキュリティ、パフォーマンス、保守性、エラーハンドリング、テストカバレッジ
