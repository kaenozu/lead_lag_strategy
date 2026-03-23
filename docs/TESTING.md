# テストと品質ゲート

## コマンド

```bash
npm test
```

`package.json` の `test` は、構文チェック、`doctor:ci`、**Jest（カバレッジ付き）**を順に実行します。

## 修正済みの既知問題（参考）

- **`tests/lib/portfolio/build.test.js`**: `buildPortfolio` の実装（空シグナルは `[]`、無効 quantile はデフォルト 0.3、同一値はニュートラル）と期待値を一致させました。
- **`lib/math/stats.js` の `correlationMatrix`**: 標準化後の内積の除数を `n` から `n-1` にし、完全共線データでピアソン相関が 1 になるよう標本相関と整合させました。

## お金に触れる前に

リリースや実運用の前に `npm test` が完走することを推奨します。失敗がある場合は、修正するか、意図的なスキップなら理由を PR / イシューに記録してください。
