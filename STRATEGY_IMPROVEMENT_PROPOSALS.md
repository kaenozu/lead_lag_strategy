# 戦略改善提案書 - 第 2 弾

**作成日**: 2026-03-28  
**目的**: 現状の戦略（B+ 評価）を A 評価（SR 1.0+）に引き上げるための具体的改善策

---

## 現状の課題整理

### KPI 達成状況（再掲）

| 指標 | 目標 | 実際 | 差分 | 優先度 |
|------|------|------|------|--------|
| シャープレシオ | 0.8 | 0.75 | -0.05 | 🟡 中 |
| 年率リターン | 10% | 9.18% | -0.82% | 🟡 中 |
| 最大ドローダウン | -12% | -17.74% | -5.74% | 🔴 高 |
| 勝率 | 55% | 51.1% | -3.9% | 🔴 高 |

---

## 改善提案 1: 動的パラメータ調整 🔴

### 概要

市場環境に応じてパラメータを動的に調整する。

### 実装案

```javascript
// 市場ボラティリティに応じて lookback を調整
function getDynamicLookback(marketVol, baseLookback = 20) {
  if (marketVol > 0.25) return 10;      // 高ボラ：短期で反応
  if (marketVol < 0.10) return 40;      // 低ボラ：長期で安定
  return baseLookback;                  // 通常：標準
}

// 市場トレンドに応じて quantile を調整
function getDynamicQuantile(marketTrend, baseQuantile = 0.20) {
  if (Math.abs(marketTrend) > 0.002) return 0.15;  // トレンド時：銘柄絞る
  return baseQuantile;                              // 通常：標準
}
```

### 予想効果

- シャープレシオ：+0.05-0.10 改善
- 最大 DD：-2-3% 改善

### 実装コスト

- 開発：2-3 時間
- バックテスト：1 時間

---

## 改善提案 2: 機械学習シグナル統合 🟡

### 概要

複数戦略のシグナルを機械学習で統合し、精度向上。

### 実装案

```javascript
// 特徴量エンジニアリング
const features = {
  // テクニカル
  momentum_20d: calculateMomentum(prices, 20),
  momentum_60d: calculateMomentum(prices, 60),
  rsi: calculateRSI(prices, 14),
  bollinger_position: calculateBollingerPosition(prices, 20),
  
  // ボラティリティ
  historical_vol: calculateHistoricalVol(prices, 20),
  implied_vol: getImpliedVolatility(ticker), // 外部データ
  
  // 出来高
  volume_ratio: currentVolume / averageVolume,
  
  // 相関
  sector_correlation: calculateSectorCorrelation(returns),
  
  // マクロ
  yield_curve_slope: get10Y2YSpread(),
  credit_spread: getCreditSpread(),
  vix: getVIX()
};

// 予測モデル（LightGBM または XGBoost）
const model = await loadModel('mean_reversion_signal.json');
const signalConfidence = await model.predict(features);

// 信頼度でウェイト調整
const adjustedWeights = baseWeights.map(w => w * signalConfidence);
```

### 予想効果

- 勝率：51.1% → 54-56%
- シャープレシオ：+0.10-0.15 改善

### 実装コスト

- データ収集：4-6 時間
- モデル学習：6-8 時間
- 実装：4-6 時間

---

## 改善提案 3: ペアトレード併用 🟡

### 概要

平均回帰戦略にペアトレードを追加し、市場ニュートラル化。

### 実装案

```javascript
// 業種間の相関が高いペアを特定
const pairs = [
  { long: '1617.T', short: '1618.T', correlation: 0.85 }, // 食品 vs 鉄鋼
  { long: '1626.T', short: '1627.T', correlation: 0.82 }, // 銀行 vs 保険
  { long: '1630.T', short: '1632.T', correlation: 0.78 }  // 小売 vs 化学
];

// ペアごとにスプレッド計算
for (const pair of pairs) {
  const spread = returns[pair.long] - returns[pair.short];
  const zScore = (spread - spread.mean(20)) / spread.std(20);
  
  // ゼロクロス戦略
  if (zScore < -2) {
    // スプレッドが拡大：ロング・ショート
    openPairTrade(pair.long, pair.short, 'long');
  } else if (zScore > 2) {
    // スプレッドが縮小：ショート・ロング
    openPairTrade(pair.long, pair.short, 'short');
  }
}
```

### 予想効果

- 市場リスク低減（ベータ 0.5-0.7）
- 最大 DD：-3-5% 改善
- シャープレシオ：+0.05-0.10 改善

### 実装コスト

- ペア選定：2-3 時間
- 実装：3-4 時間

---

## 改善提案 4: ファンダメンタルデータ追加 🟢

### 概要

バリュー・クオリティファクターを追加し、シグナル精度向上。

### 実装案

```javascript
// ファンダメンタルスコア計算
const fundamentalScore = {
  // バリュー
  valueScore: calculateValueScore({
    per: priceToEarningsRatio,
    pbr: priceToBookRatio,
    pcr: priceToCashFlowRatio
  }),
  
  // クオリティ
  qualityScore: calculateQualityScore({
    roe: returnOnEquity,
    profitMargin: netProfitMargin,
    debtToEquity: debtToEquityRatio
  }),
  
  // モメンタム（業績）
  momentumScore: calculateEarningsMomentum({
    earningsRevisions: analystRevisions,
    surpriseHistory: earningsSurpriseHistory
  })
};

// 総合スコア
const compositeScore = (
  valueScore * 0.4 +
  qualityScore * 0.4 +
  momentumScore * 0.2
);

// シグナルと統合
const finalSignal = technicalSignal * 0.7 + compositeScore * 0.3;
```

### データソース

| データ | ソース | 更新頻度 |
|--------|--------|----------|
| PER・PBR | Yahoo! ファイナンス | 日次 |
| ROE・利益率 | 会社四季報 | 四半期 |
| アナリスト予想 | I/B/E/S | 日次 |

### 予想効果

- 勝率：+2-3% 改善
- 年率リターン：+1-2% 改善

### 実装コスト

- データ収集：6-8 時間
- 実装：4-6 時間

---

## 改善提案 5: ボラティリティ・ターゲティング 🟢

### 概要

ポートフォリオのボラティリティを一定水準に制御。

### 実装案

```javascript
// 目標ボラティリティ（年率 10%）
const TARGET_VOL = 0.10;

// 直近 20 日の実現ボラティリティ計算
const recentVol = calculateRealizedVol(returns, 20);

// ポジションサイズ調整
const positionMultiplier = TARGET_VOL / recentVol;

// 制限（0.5-1.5 倍）
const adjustedMultiplier = Math.max(0.5, Math.min(1.5, positionMultiplier));

// 適用
const finalWeights = baseWeights.map(w => w * adjustedMultiplier);
```

### 予想効果

- リスク調整後リターン向上
- 最大 DD：-2-3% 改善
- シャープレシオ：+0.05 改善

### 実装コスト

- 実装：1-2 時間

---

## 改善提案 6: アンサンブル戦略 🟡

### 概要

複数戦略のシグナルをアンサンブルし、安定性向上。

### 実装案

```javascript
// 複数戦略のシグナルを計算
const signals = {
  meanReversion: calculateMeanReversionSignal(),  // 現状戦略
  momentum: calculateMomentumSignal(),            // モメンタム
  value: calculateValueSignal(),                  // バリュー
  quality: calculateQualitySignal()               // クオリティ
};

// 重み付け統合（等重みまたはパフォーマンスベース）
const weights = {
  meanReversion: 0.4,
  momentum: 0.2,
  value: 0.2,
  quality: 0.2
};

const ensembleSignal = Object.entries(signals).reduce((sum, [name, signal]) => {
  return sum + signal * weights[name];
}, 0);
```

### 予想効果

- 戦略リスク分散
- シャープレシオ：+0.10-0.15 改善
- 最大 DD：-3-5% 改善

### 実装コスト

- 他戦略実装：8-12 時間
- アンサンブル：2-3 時間

---

## 改善提案 7: 取引タイミング最適化 🟢

### 概要

OC リターンの特性を考慮し、取引タイミングを最適化。

### 実装案

```javascript
// 始値・終値パターンの分析
const openClosePattern = analyzeOpenClosePattern(historicalData);

// 始値乖離が大きい日は取引を控える
const openGap = (todayOpen - yesterdayClose) / yesterdayClose;
if (Math.abs(openGap) > 0.02) {
  positionSize *= 0.5; // 2% 以上のギャップは半分
}

// 寄成り・引けの最適化
if (expectedReturn > 0) {
  // 買い：寄成りでエントリー、引けでイグジット
  entryType = 'open';
  exitType = 'close';
} else {
  // 売り：引けでエントリー、寄成りでイグジット
  entryType = 'close';
  exitType = 'open';
}
```

### 予想効果

- 取引コスト削減：-0.1-0.2%/年
- 勝率：+1-2% 改善

### 実装コスト

- 実装：2-3 時間

---

## 改善優先度マトリックス

| 提案 | 効果 | コスト | ROI | 優先度 |
|------|------|--------|-----|--------|
| 1. 動的パラメータ調整 | 中 | 低 | 高 | 🔴 高 |
| 2. 機械学習シグナル | 高 | 高 | 中 | 🟡 中 |
| 3. ペアトレード併用 | 中 | 中 | 高 | 🟡 中 |
| 4. ファンダメンタル | 中 | 中 | 中 | 🟢 低 |
| 5. ボラティリティ・ターゲット | 小 | 低 | 高 | 🔴 高 |
| 6. アンサンブル戦略 | 高 | 高 | 中 | 🟡 中 |
| 7. 取引タイミング | 小 | 低 | 中 | 🟢 低 |

---

## 推奨実装順序

### Phase 1: 即効性重視（1-2 週間）

1. **動的パラメータ調整**（2-3 時間）
2. **ボラティリティ・ターゲティング**（1-2 時間）
3. **取引タイミング最適化**（2-3 時間）

**予想効果**: SR +0.10-0.15, MDD -3-5%

### Phase 2: 中長期（1-2 ヶ月）

4. **ペアトレード併用**（5-7 時間）
5. **ボラティリティ・ターゲティング**（1-2 時間）
6. **アンサンブル戦略**（10-15 時間）

**予想効果**: SR +0.15-0.25, MDD -5-8%

### Phase 3: 先進的（3-6 ヶ月）

7. **機械学習シグナル**（14-18 時間）
8. **ファンダメンタルデータ**（10-14 時間）

**予想効果**: SR +0.15-0.20, 勝率 +3-5%

---

## 改善後の目標 KPI

| 指標 | 現状 | Phase 1 後 | Phase 2 後 | Phase 3 後 |
|------|------|-----------|-----------|-----------|
| シャープレシオ | 0.75 | **0.85** | **1.00** | **1.15** |
| 年率リターン | 9.18% | **10%** | **12%** | **14%** |
| 最大ドローダウン | -17.74% | **-14%** | **-12%** | **-10%** |
| 勝率 | 51.1% | **52%** | **54%** | **56%** |

---

## 結論

### 推奨アクション

**即時着手（Phase 1）**:
1. 動的パラメータ調整
2. ボラティリティ・ターゲティング

**予想投資対効果**:
- 開発時間：5-8 時間
- シャープレシオ：+0.10-0.15 改善
- 最大 DD：-3-5% 改善

**達成可能 KPI**:
- シャープレシオ：**0.85+**（目標 0.8 クリア）
- 最大ドローダウン：**-14%**（目標 -12% に迫る）

### 最終目標

**全 Phase 完了後**:
- シャープレシオ：**1.15+**（A 評価）
- 年率リターン：**14%+**
- 最大ドローダウン：**-10%**

---

**作成者**: 自動最適化パイプライン  
**次回更新**: 2026-04-04（Phase 1 完了予定）
