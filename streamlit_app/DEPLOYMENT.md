# Streamlit Cloud デプロイガイド

## 概要

日米業種リードラグ戦略の Streamlit Cloud 向けデプロイメントガイドです。

## Streamlit Cloud での実行方法

### 1. GitHub リポジトリを接続

1. [Streamlit Cloud](https://streamlit.io/cloud) にアクセス
2. "New app" をクリック
3. GitHub リポジトリ `kaenozu/lead_lag_strategy` を選択
4. Main branch を選択
5. File path: `streamlit_app/app.py`
6. Advanced settings -> Python version: 3.10 以上

### 2. 必要な設定

#### requirements-streamlit.txt

既に更新済み：
```
streamlit>=1.28.0
pandas>=2.0.0
numpy>=1.24.0
yfinance>=0.2.0
```

#### 環境変数（任意）

Streamlit Cloud の Settings -> Secrets で以下を設定：

```
ALPHA_VANTAGE_API_KEY=your_api_key
JQUANTS_API_KEY=your_jquants_key
```

### 3. デプロイ

"Deploy!" ボタンをクリック

## 機能

### シグナル生成ボタン

Streamlit Cloud 環境では、**「🔄 シグナル生成（Python 版）」**ボタンを使用します。

- Node.js が不要な純粋な Python 実装
- yfinance を使用して Yahoo Finance からデータ取得
- 部分空間正則化 PCA の簡易実装

### 表示内容

1. **シグナルタブ**: ロング・ショート候補銘柄
2. **バックテスト CSV タブ**: 過去のバックテスト結果
3. **ペーパータブ**: ペーパー取引記録
4. **results ファイルタブ**: 出力ファイル一覧

## 制限事項

### Python 版の制限

- 簡易実装のため、Node.js 版と完全に一致しない場合があります
- 部分空間正則化は近似計算を使用
- 事前部分空間（グローバル・カントリー・シクリカルファクター）は固定

### データ取得

- yfinance のレート制限に従ってください
- 日本 ETF（1617.T 等）は Yahoo Finance Japan から取得
- 遅延データ（15-20 分）を使用

## トラブルシューティング

### エラー：「yfinance がインストールされていません」

**解決策**:
1. Streamlit Cloud の Settings -> Secrets で requirements-streamlit.txt が認識されているか確認
2. アプリを再デプロイ

### エラー：「データ取得に失敗しました」

**解決策**:
1. ネットワーク接続を確認
2. 時間をおいて再試行（レート制限の可能性）
3. 個別銘柄で Yahoo Finance で検索可能か確認

### シグナルが生成されない

**解決策**:
1. ブラウザのコンソールでエラーを確認
2. Streamlit Cloud の "Manage app" -> Logs でログを確認
3. results ディレクトリの権限を確認（通常は自動作成）

## ローカルでのテスト

```bash
# 仮想環境作成（推奨）
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Mac/Linux

# 依存関係インストール
pip install -r requirements-streamlit.txt

# Streamlit 起動
cd streamlit_app
streamlit run app.py
```

## 次のステップ

1. デプロイ後、最初のシグナル生成を実行
2. 結果を確認
3. 必要に応じて環境変数を設定
4. 定期的な更新のためにスケジュールを検討（Streamlit Cloud の自動更新機能）

## サポート

問題が発生した場合は：
1. Streamlit Cloud のログを確認
2. GitHub Issues で報告
3. エラーメッセージを添付

---

**注意**: このアプリは教育・研究目的です。投資助言ではありません。
