---
name: lead-lag-parity-modularization
description: "Use when: 数値的正確性の検証（Parity）, サーバー機能追加・リファクタリング, 数学アルゴリズムの調整, データのフォールバックロジック修正"
---

# lead-lag-parity-modularization

## Purpose
このスキルは、lead_lag_strategy における「PythonリファレンスとNode.js実装の数値的一致（Parity）」および「サーバーアーキテクチャの整合性」を維持するための高度なエンジニアリング指針です。

## Core Principles

### 1. Numerical Parity (数値的照合)
Python (NumPy/SciPy) と Node.js (カスタム数学ライブラリ) の間で、計算結果が一致することを保証する必要があります。
- **検証基準:** 最終的なシグナル値の誤差は $10^{-5}$ 以内、相関行列の誤差は $10^{-6}$ 以内を目標とする。
- **固有値分解:** 実対称行列の上位K個を抽出する際は `eigenSymmetricTopK` を使用し、収束判定には「ベクトル間の角度のコサイン ($1 - \text{tol}$」を用いること。
- **Golden Data:** `tests/paper_parity.test.js` と `tests/fixtures/paper_parity_expected.json` を常に正とし、アルゴリズム変更時は必ずこのテストで回帰確認を行う。

### 2. Modular Server Architecture
`src/server.js` はエントリーポイントに留め、ロジックを直接記述しない。
- **Bootstrap:** `src/server/bootstrap.js` で依存性の注入（DI）とミドルウェア設定を行う。
- **Routes:** APIエンドポイントは `src/server/routes/` 下に機能別（strategy, ops, config, system）に分割する。
- **Services:** ビジネスロジック（バックテスト実行、シグナル計算等）は `src/server/services/` にカプセル化し、Request/Responseオブジェクトから分離してテスト可能にする。
- **Validation:** パラメータ検証は `src/server/modules/paramValidation.js` に集約する。

### 3. Data Robustness & Recovery
データ取得の失敗や不足は運用上の最大のリスクです。
- **Parallel Fetch:** 地域別（US/JP）の並列取得を基本とする。
- **Auto-Recovery:** プライマリソース（AlphaVantage/J-Quants）で営業日が不足する場合、自動的に Yahoo Finance 経路へフォールバックするロジックを維持する。
- **Alignment:** 米日のカレンダーアライメントが正しく行われているか、常に `dates` の長さをチェックする。

## Workflow for New Features
1. **Math First:** 数学的な変更を伴う場合は、まず Python版でプロトタイプし、Parity Testを更新する。
2. **Service Layer:** ロジックを `strategyService.js` に追加し、ユニットテストを作成する。
3. **Route Integration:** 必要に応じて新しい Route モジュールを作成し、`bootstrap.js` でレジストリに追加する。
4. **Ops Audit:** 重要な操作（設定変更、計画作成）には `writeAudit` を通じて監査ログを記録する。

## Mandatory Checks
- [ ] `npm test tests/paper_parity.test.js` で数値的一致を確認
- [ ] `npm run lint` でコードスタイルを確認
- [ ] `src/server.js` の肥大化を避け、モジュール分割が維持されているか確認
