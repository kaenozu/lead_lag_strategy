---
name: lead-lag-refactor
description: "Use when: リファクタリング, lint修正, 非破壊修正, npm test, quality gate, non-breaking refactor, lint fix, test validation"
---

# lead-lag-refactor

## Purpose
このスキルは、lead_lag_strategy リポジトリで既存挙動を壊さずにリファクタリングするための実務手順です。
小さな改善を安全に積み重ね、lint/test の品質ゲートを必ず通すときに使います。

## When to use
- 関数分割、重複削減、命名改善などの非破壊リファクタリング
- lint エラー修正や軽微な可読性改善
- 変更後に npm run lint / npm test で回帰確認したいとき

## Workflow
1. 変更対象を最小化する。目的外の修正は入れない。
2. 既存の公開 API、入出力、ファイル形式、CLI 振る舞いを維持する。
3. 1つの意図ごとに小さく編集し、差分を見て意図しない変更を除去する。
4. 必要ならテストを追加 or 更新する。ただし仕様変更はしない。
5. 品質ゲートを実行し、失敗時は原因を修正して再実行する。

## Mandatory validation
以下は必須:

```bash
npm run lint
npm test
```

- 両方成功するまで完了扱いにしない。
- 実行できない場合は理由を明記し、代替確認を記録する。

## Safety rules
- Non-breaking を最優先。既存仕様を変えない。
- 関連しないリファクタや広域整形をしない。
- 不要な import 並び替えや改行調整だけの変更を混ぜない。
- 大規模変更より小分けの確実な変更を優先する。

## Reporting template
作業完了時は次の形式で報告する:

```md
Summary:
- 目的:
- 実施内容:

Changed files:
- path/to/file1: 変更要点
- path/to/file2: 変更要点

Validation:
- npm run lint: Pass/Fail (要点)
- npm test: Pass/Fail (要点)

Risk:
- 回帰リスクの有無と根拠
```
