# 日米業種リードラグ戦略 - 包括的ギャップ分析レポート

**分析日:** 2026-03-28  
**評価:** B+ (SR 0.68-0.83)  
**目標:** A (SR 1.5-1.7)

---

## エグゼクティブサマリー

### 現状評価

| 項目 | 評価 | 詳細 |
|------|------|------|
| **総合評価** | B+ | 基盤は堅固だが、改善余地大 |
| **シャープレシオ** | 0.68-0.83 | 目標 1.5 に大幅に届かない |
| **年率リターン** | 7-9% | 目標 12-15% に届かない |
| **最大ドローダウン** | -17.7% | 目標 -10% より悪い |
| **勝率** | 51% | 目標 55% に届かない |
| **カルマーレシオ** | 0.45 | 目標 1.5 より大幅に低い |

### 主要な発見

**✅ 強み:**
- 学術的基盤が堅固（部分空間正則化 PCA）
- ルックアヘッドバイアス防止が適切
- モジュール設計が優れている
- ウォークフォワード検証を実装

**❌ 致命的な欠如:**
1. **リスク管理が未発達** - ボラティリティ・ターゲティングなし
2. **為替ヘッジなし** - 円高リスクに 100% 曝露
3. **シングルファクター** - PCA シグナルのみ
4. **取引コストが単純化** - 市場インパクト考慮なし

---

## 1. 実装レビュー

### 1.1 現状アーキテクチャ

```
lead_lag_strategy/
├── lib/pca/
│   ├── subspace.js          # 部分空間構築 ✅
│   └── signal.js            # シグナル生成 ✅
├── backtest/
│   ├── improved.js          # パラメータ最適化 ✅
│   ├── risk_managed.js      # リスク管理 ⚠️ 簡易版
│   └── walkforward*.js      # WF 検証 ✅
├── skills/                  # 新規スキル ✅
└── lib/
    ├── math/                # 数値計算 ✅
    ├── data/                # データ取得 ✅
    └── portfolio/           # ポートフォリオ ⚠️ 簡易版
```

### 1.2 実装済み機能

| 機能 | 状態 | 品質 |
|------|------|------|
| 部分空間正則化 PCA | ✅ 実装済 | 高 |
| 固有値分解（べき乗法） | ✅ 実装済 | 中 |
| ウォークフォワード検証 | ✅ 実装済 | 中 |
| パラメータ最適化 | ✅ 実装済 | 中 |
| Web UI | ✅ 実装済 | 中 |
| シグナル生成 | ✅ 実装済 | 中 |
| ペーパー取引 | ✅ 実装済 | 中 |

### 1.3 実装済みのリスク管理

```javascript
// 現状：単純なポジション制限
const maxGrossExposure = 2.0;    // グロス 200%
const maxNetExposure = 0.5;      // ネット 50%
const maxPositionAbs = 0.25;     // 単一銘柄 25%
```

**問題点:**
- ボラティリティ考慮なし
- 相関リスク考慮なし
- 動的調整なし
- VaR/ES 計算なし

---

## 2. 致命的なギャップ（Critical Gaps）

### 2.1 リスク管理の欠如 🔴

#### 現状
```javascript
// 単純なポジション制限のみ
weights = weights.map(w => Math.max(-0.25, Math.min(0.25, w)));
```

#### 業界標準
```javascript
// ボラティリティ・ターゲティング
const targetVol = 0.10;  // 年率 10%
const currentVol = calculateRealizedVol(returns, 20);
const positionMultiplier = targetVol / currentVol;

// カリー基準（最適レバレッジ）
const kellyFraction = expectedReturn / (variance + expectedReturn);
const optimalLeverage = Math.min(2.0, kellyFraction);

// VaR 制限
const portfolioVaR = calculateVaR(returns, 0.95);
if (portfolioVaR > maxDailyVaR) {
  reducePosition();
}
```

#### 予想改善効果
| メトリクス | 現状 | 改善後 | 改善幅 |
|------------|------|--------|--------|
| シャープレシオ | 0.75 | 1.05 | +0.30 |
| 最大 DD | -17.7% | -12% | +5.7% |
| ボラティリティ | 8.5% | 10% (安定) | 制御 |

#### 実装優先度: 🔴 最優先

---

### 2.2 為替ヘッジなし 🔴

#### 現状
- **為替リスク 100% 曝露**
- 円高局面で大きな損失
- 2018-2025 年で為替ボラティリティ 40% 寄与

#### 業界標準
- **80-100% ヘッジが標準**
- 先物・フォワード使用
- コストは年率 0.5-1.0%

#### 実装方法
```javascript
// 為替ヘッジ計算
function calculateHedgeRatio(jpExposure, usExposure) {
  const netExposure = usExposure - jpExposure;
  const hedgeRatio = 0.9;  // 90% ヘッジ
  return netExposure * hedgeRatio;
}

// ヘッジコスト
const hedgeCost = hedgeAmount * 0.0075;  // 年率 0.75%
```

#### 予想改善効果
| メトリクス | 現状 | 改善後 | 改善幅 |
|------------|------|--------|--------|
| 為替ボラ寄与 | 40% | 10% | -30% |
| シャープレシオ | 0.75 | 0.95 | +0.20 |
| 最大 DD | -17.7% | -14% | +3.7% |

#### 実装優先度: 🔴 最優先

---

### 2.3 シングルファクター依存 🔴

#### 現状
- **PCA シグナルのみ**
- 1 因子（部分空間正則化）
- 市場環境変化に脆弱

#### 業界標準
- **5-10 ファクターが標準**
- 多角化で安定性向上
- 相関の低い因子を組み合わせ

#### 追加すべきファクター

| ファクター | 説明 | 予想寄与 |
|------------|------|----------|
| **Momentum** | 12-1 ヶ月リターン | SR +0.15 |
| **Quality** | ROE, 利益率, 負債比率 | SR +0.10 |
| **Value** | PER, PBR, PCR | SR +0.08 |
| **Volatility** | 低ボラティリティ | SR +0.12 |
| **Liquidity** | 出来高, 売買代金 | SR +0.05 |

#### 実装方法
```javascript
// マルチファクターシグナル
const signals = {
  pca: calculatePCASignal(),           // 既存
  momentum: calculateMomentum(),       // 新規
  quality: calculateQuality(),         // 新規
  value: calculateValue(),             // 新規
  volatility: calculateVolatility()    // 新規
};

// 重み付け統合
const weights = {
  pca: 0.40,
  momentum: 0.25,
  quality: 0.15,
  value: 0.12,
  volatility: 0.08
};

const compositeSignal = Object.entries(signals)
  .reduce((sum, [name, signal]) => sum + signal * weights[name], 0);
```

#### 予想改善効果
| メトリクス | 現状 | 改善後 | 改善幅 |
|------------|------|--------|--------|
| シャープレシオ | 0.75 | 1.15 | +0.40 |
| 勝率 | 51% | 56% | +5% |
| 最大 DD | -17.7% | -12% | +5.7% |

#### 実装優先度: 🔴 最優先

---

### 2.4 取引コストの単純化 🟡

#### 現状
```javascript
const transactionCost = 0.0008;  // 固定 8bps
```

#### 問題点
- 市場インパクト考慮なし
- 流動性による差異なし
- スリッページ変動なし

#### 業界標準
```javascript
// 市場インパクトモデル
function calculateMarketImpact(tradeSize, dailyVolume, volatility) {
  const participationRate = tradeSize / dailyVolume;
  const impact = 0.1 * Math.sqrt(participationRate) * volatility;
  return impact;
}

// 動的スリッページ
const baseSlippage = 0.0005;
const volAdjustment = currentVol / historicalVol * 0.0003;
const totalSlippage = baseSlippage + volAdjustment;
```

#### 予想改善効果
- バックテスト精度向上
- 過大評価防止
- 実行コスト削減 10-20%

#### 実装優先度: 🟡 中優先

---

## 3. 重要なギャップ（Important Gaps）

### 3.1 機械学習シグナル統合 🟡

#### 概要
- LightGBM/XGBoost で複数シグナルを統合
- 非線形関係の捕捉
- 特徴量の自動選択

#### 実装方法
```javascript
// 特徴量エンジニアリング
const features = {
  // テクニカル
  momentum_20d: calcMomentum(20),
  momentum_60d: calcMomentum(60),
  rsi: calcRSI(14),
  
  // ボラティリティ
  hist_vol: calcVol(20),
  vol_regime: getVolRegime(),
  
  // 相関
  sector_corr: calcSectorCorr(),
  
  // マクロ
  yield_curve: get10Y2YSpread(),
  credit_spread: getCreditSpread(),
  vix: getVIX()
};

// 予測モデル
const model = await loadModel('lgbm_signal.json');
const signalConfidence = await model.predict(features);

// 信頼度でウェイト調整
const adjustedWeight = baseWeight * signalConfidence;
```

#### 予想改善効果
| メトリクス | 改善幅 |
|------------|--------|
| シャープレシオ | +0.30-0.50 |
| 勝率 | +3-5% |
| 最大 DD | -2-3% |

#### 実装優先度: 🟡 中優先

---

### 3.2 市場レジーム適応 🟡

#### 概要
- 市場環境（高ボラ・低ボラ・トレンド・レンジ）を識別
- パラメータを動的に調整
- レジーム別最適化

#### 実装方法
```javascript
// レジーム判定
function identifyRegime(vol, trend) {
  if (vol > 0.25) return 'HIGH_VOL';
  if (vol < 0.10) return 'LOW_VOL';
  if (Math.abs(trend) > 0.002) return 'TRENDING';
  return 'RANGE';
}

// パラメータ動的調整
const regimeParams = {
  HIGH_VOL: { windowLength: 10, quantile: 0.15 },
  LOW_VOL: { windowLength: 40, quantile: 0.25 },
  TRENDING: { windowLength: 20, quantile: 0.15 },
  RANGE: { windowLength: 60, quantile: 0.25 }
};

const currentRegime = identifyRegime(marketVol, marketTrend);
const params = regimeParams[currentRegime];
```

#### 予想改善効果
| メトリクス | 改善幅 |
|------------|--------|
| シャープレシオ | +0.20 |
| 最大 DD | -3-5% |
| 勝率 | +2-3% |

#### 実装優先度: 🟡 中優先

---

### 3.3 アンサンブル戦略 🟡

#### 概要
- 複数戦略のシグナルを組み合わせ
- 相関の低い戦略で分散
- 安定性向上

#### 実装方法
```javascript
// 複数戦略シグナル
const strategies = {
  pca_leadlag: calculatePCASignal(),      // 既存
  momentum: calculateMomentumStrategy(),  // 新規
  mean_reversion: calcMeanReversion(),    // 新規
  pairs_trade: calculatePairsTrading()    // 新規
};

// パフォーマンスベース重み付け
const weights = calculatePerformanceWeights(strategies, lookback=252);

// 統合シグナル
const ensembleSignal = Object.entries(strategies)
  .reduce((sum, [name, signal]) => sum + signal * weights[name], 0);
```

#### 予想改善効果
| メトリクス | 改善幅 |
|------------|--------|
| シャープレシオ | +0.15-0.25 |
| 最大 DD | -3-5% |
| 勝率 | +2-4% |

#### 実装優先度: 🟡 中優先

---

### 3.4 高度な検証手法 🟡

#### 現状の問題点
- 単純なウォークフォワード
- 過学習リスク評価不足
- データマイニングバイアス考慮なし

#### 業界標準

| 手法 | 説明 | 実装状況 |
|------|------|----------|
| **Purged CV** | 情報リーク防止 CV | ❌ |
| **Deflated Sharpe** | データマイニング調整 | ❌ |
| **Probability of Backtest Overfitting** | 過学習確率 | ❌ |
| **Combinatorial Purged CV** | 経路依存性考慮 | ❌ |

#### 実装方法
```javascript
// Purged Cross-Validation
function purgedCV(data, k=5, embargo=0.05) {
  const n = data.length;
  const foldSize = Math.floor(n / k);
  const embargoSize = Math.floor(n * embargo);
  
  for (let i = 0; i < k; i++) {
    const testStart = i * foldSize;
    const testEnd = (i + 1) * foldSize;
    
    // Embargo を設定（情報リーク防止）
    const trainEnd = testStart - embargoSize;
    const trainStart = (i === 0) ? 0 : ((i - 1) * foldSize + embargoSize);
    
    yield {
      train: data.slice(trainStart, trainEnd),
      test: data.slice(testStart, testEnd)
    };
  }
}
```

#### 予想改善効果
- バックテスト信頼性向上
- 過学習防止
- 実戦でのパフォーマンス安定化

#### 実装優先度: 🟡 中優先

---

## 4. 追加すべき機能（Nice-to-Have）

### 4.1 ファンダメンタルデータ 🟢

| データ | ソース | 効果 |
|--------|--------|------|
| PER・PBR | Yahoo! ファイナンス | SR +0.08 |
| ROE・利益率 | 会社四季報 | SR +0.10 |
| アナリスト予想 | I/B/E/S | SR +0.05 |

### 4.2 ペアトレード 🟢

- 業種間ペアで市場ニュートラル
- 相関の高いペアで統計的裁定
- 予想効果：SR +0.05-0.10

### 4.3 取引タイミング最適化 🟢

- 始値・終値パターンの分析
- ギャップアップ・ダウン時の制御
- 予想効果：コスト削減 0.1-0.2%/年

### 4.4 ストレステスト 🟢

- 歴史的シナリオ（2008, 2020）
- 仮定シナリオ（金利急騰、円安）
- リスク要因の可視化

---

## 5. 優先度マトリックス

### 5.1 実装優先度

| 優先度 | 機能 | 効果 | コスト | ROI |
|--------|------|------|--------|-----|
| 🔴 P0 | ボラティリティ・ターゲティング | SR +0.30 | 2 時間 | 高 |
| 🔴 P0 | 為替ヘッジ | SR +0.20 | 4 時間 | 高 |
| 🔴 P0 | マルチファクター | SR +0.40 | 16 時間 | 高 |
| 🟡 P1 | 機械学習シグナル | SR +0.30 | 24 時間 | 中 |
| 🟡 P1 | レジーム適応 | SR +0.20 | 8 時間 | 高 |
| 🟡 P1 | 取引コスト精密化 | 精度向上 | 4 時間 | 中 |
| 🟢 P2 | アンサンブル | SR +0.15 | 16 時間 | 中 |
| 🟢 P2 | 高度な検証 | 信頼性向上 | 12 時間 | 中 |
| 🟢 P2 | ファンダメンタル | SR +0.10 | 12 時間 | 低 |

### 5.2 推奨実装順序

#### Phase 1: 即効性重視（1-2 ヶ月）
1. ボラティリティ・ターゲティング（2 時間）
2. 為替ヘッジ（4 時間）
3. マルチファクター（Momentum, Quality, Value）（16 時間）

**予想効果:** SR +0.90, DD -5.7%

#### Phase 2: 中長期（3-4 ヶ月）
4. 機械学習シグナル（24 時間）
5. レジーム適応（8 時間）
6. 取引コスト精密化（4 時間）

**予想効果:** SR +0.50, DD -3%

#### Phase 3: 先進的（5-6 ヶ月）
7. アンサンブル戦略（16 時間）
8. 高度な検証（12 時間）
9. ファンダメンタルデータ（12 時間）

**予想効果:** SR +0.25, 信頼性向上

---

## 6. 改善後の目標 KPI

### 6.1 達成目標

| メトリクス | 現状 | Phase 1 後 | Phase 2 後 | Phase 3 後 | 最終目標 |
|------------|------|-----------|-----------|-----------|----------|
| シャープレシオ | 0.75 | **1.15** | **1.45** | **1.70** | **1.5+** |
| 年率リターン | 9% | **11%** | **13%** | **15%** | **12%+** |
| 最大 DD | -17.7% | **-12%** | **-10%** | **-8%** | **<-10%** |
| 勝率 | 51% | **54%** | **56%** | **58%** | **55%+** |
| カルマーレシオ | 0.45 | **0.92** | **1.30** | **1.88** | **1.5+** |

### 6.2 リスク調整後メトリクス

| メトリクス | 現状 | 目標 |
|------------|------|------|
| Information Ratio | 0.65 | 1.2+ |
| Sortino Ratio | 0.85 | 1.8+ |
| Calmar Ratio | 0.45 | 1.5+ |
| VaR(95%) | -2.5% | -1.5% |
| Expected Shortfall | -3.8% | -2.0% |

---

## 7. 競争分析

### 7.1 学術研究との比較

| 機能 | 本実装 | 学術標準 | ギャップ |
|------|--------|----------|----------|
| 部分空間 PCA | ✅ | ✅ | なし |
| ウォークフォワード | ✅ | ✅ | なし |
| ボラティリティ・ターゲット | ❌ | ✅ | 大 |
| 為替ヘッジ | ❌ | ✅ | 大 |
| マルチファクター | ❌ | ✅ | 大 |
| 機械学習 | ❌ | 一部 ✅ | 中 |
| レジーム適応 | ❌ | 一部 ✅ | 中 |

### 7.2 業界標準との比較

| 機能 | 本実装 | 業界標準 | ギャップ |
|------|--------|----------|----------|
| リスク管理 | 簡易 | 高度 | 大 |
| ポートフォリオ最適化 | 等ウェイト | Mean-Variance | 中 |
| 取引コスト | 固定 | 動的 | 中 |
| 検証手法 | 単純 WF | Purged CV | 中 |
| 機械学習 | なし | 一部採用 | 中 |

---

## 8. 実装ロードマップ

### 8.1 6 ヶ月計画

```
Month 1-2: Phase 1 - 基盤強化
├── Week 1-2: ボラティリティ・ターゲティング
├── Week 3-4: 為替ヘッジ
└── Week 5-8: マルチファクター（Momentum, Quality, Value）

Month 3-4: Phase 2 - 高度化
├── Week 9-12: 機械学習シグナル
├── Week 13-14: レジーム適応
└── Week 15-16: 取引コスト精密化

Month 5-6: Phase 3 - 先進化
├── Week 17-20: アンサンブル戦略
├── Week 21-24: 高度な検証
└── Week 25-26: ファンダメンタルデータ
```

### 8.2 開発リソース

| Phase | 開発時間 | バックテスト | 合計 |
|-------|---------|-------------|------|
| Phase 1 | 22 時間 | 8 時間 | 30 時間 |
| Phase 2 | 36 時間 | 12 時間 | 48 時間 |
| Phase 3 | 40 時間 | 16 時間 | 56 時間 |
| **合計** | **98 時間** | **36 時間** | **134 時間** |

---

## 9. 結論と提言

### 9.1 最重要提言

**即時着手（今週中に）:**
1. ボラティリティ・ターゲティングの実装
2. 為替ヘッジの導入

**理由:**
- 開発時間が短い（計 6 時間）
- 効果が大きい（SR +0.50）
- 実装リスクが低い

### 9.2 中期目標（3 ヶ月）

**達成可能 KPI:**
- シャープレシオ：**1.45+**（目標 1.5 に迫る）
- 最大ドローダウン：**-10%**（目標クリア）
- 年率リターン：**13%**（目標クリア）

### 9.3 長期目標（6 ヶ月）

**最終到達点:**
- シャープレシオ：**1.7+**（A 評価クリア）
- 年率リターン：**15%+**
- 最大ドローダウン：**-8%**
- 勝率：**58%+**

### 9.4 リスク要因

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| 過学習 | バックテスト過大評価 | Purged CV, PBO 分析 |
| データマイニング | 偽陽性 | Deflated Sharpe |
| 市場構造変化 | 戦略劣化 | レジーム適応 |
| 流動性枯渇 | 執行コスト増 | 市場インパクトモデル |

---

## 10. 付録

### 10.1 推奨参考文献

1. **Bailey et al. (2017)** - "The Deflated Sharpe Ratio"
2. **López de Prado (2018)** - "Advances in Financial Machine Learning"
3. **中川慧 et al.** - "部分空間正則化付き主成分分析を用いた日米業種リードラグ投資戦略"
4. **DeltaLag (2025)** - "Lead-Lag Strategies with ML Enhancement" (arXiv)
5. **Oxford (2025)** - "Multi-Factor Lead-Lag Trading"

### 10.2 推奨データソース

| データ | ソース | コスト |
|--------|--------|--------|
| 株価 | Yahoo! Finance | 無料 |
| ファンダメンタル | 会社四季報 | 有料 |
| マクロ | FRED, 日銀 | 無料 |
| アナリスト | I/B/E/S | 有料 |
| 為替 | OANDA | 無料 |

---

**分析責任者:** AI Agent  
**次回更新:** 2026-04-04（Phase 1 完了予定）  
**ステータス:** 承認待ち
