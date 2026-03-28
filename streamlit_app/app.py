"""
日米業種リードラグ戦略 — Streamlit ダッシュボード

計算本体は Node（npm run signal 等）。本 UI は results/ の表示と CLI 起動のオーケストレーション。
起動: リポジトリ直下で  streamlit run streamlit_app/app.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

# Python 版シグナル生成をインポート（Streamlit Cloud 用）
# _paths よりも先にインポート（generate_signal は _paths に依存しない）
try:
    from generate_signal import generate_signal
    PYTHON_SIGNAL_AVAILABLE = True
    IMPORT_ERROR_MESSAGE = ''
except ImportError as e:
    PYTHON_SIGNAL_AVAILABLE = False
    IMPORT_ERROR_MESSAGE = str(e)

from _paths import repo_root, results_dir

st.set_page_config(
    page_title="日米リードラグ戦略",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)


def _ensure_signal_candidates(data: dict) -> dict:
    """古い signal.json に buy/sell が無い場合に推定"""
    if data.get("buyCandidates") and data.get("sellCandidates"):
        return data
    signals = data.get("signals") or []
    if not signals:
        return data
    q = float((data.get("config") or {}).get("quantile", 0.4))
    n = len(signals)
    k = max(1, int(n * q))
    ranked = sorted(signals, key=lambda x: float(x.get("signal", 0)), reverse=True)
    data = {**data}
    data["buyCandidates"] = ranked[:k]
    data["sellCandidates"] = list(reversed(ranked[-k:]))
    return data


def _load_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _run_npm_script(script: str) -> tuple[int, str]:
    root = repo_root()
    cmd = f"npm run {script}"
    try:
        p = subprocess.run(
            cmd,
            cwd=str(root),
            shell=sys.platform == "win32",
            capture_output=True,
            text=True,
            timeout=600,
            encoding="utf-8",
            errors="replace",
        )
        out = (p.stdout or "") + ("\n" + p.stderr if p.stderr else "")
        return p.returncode, out.strip() or "(出力なし)"
    except subprocess.TimeoutExpired:
        return -1, "タイムアウト（10分）"
    except OSError as e:
        return -1, str(e)


def main() -> None:
    root = repo_root()
    res = results_dir()

    with st.sidebar:
        st.header("設定")
        st.caption(f"リポジトリ: `{root}`")
        st.caption(f"results: `{res}`")
        st.divider()
        st.subheader("アクション")
        
        # Python 版シグナル生成（Streamlit Cloud 用）
        if PYTHON_SIGNAL_AVAILABLE:
            if st.button("🔄 シグナル生成（Python 版）", help="Python でシグナル生成（Streamlit Cloud 推奨）"):
                with st.spinner("シグナル生成中..."):
                    try:
                        result = generate_signal()
                        if 'error' not in result:
                            # 結果を保存
                            output_path = res / "signal.json"
                            with open(output_path, 'w', encoding='utf-8') as f:
                                json.dump(result, f, indent=2, ensure_ascii=False)
                            st.success("シグナル生成完了")
                            st.rerun()
                        else:
                            st.error(f"エラー：{result.get('error')}")
                    except Exception as e:
                        st.error(f"エラー：{str(e)}")
        else:
            # エラーメッセージを表示
            st.error("⚠️ Python 版が利用できません")
            with st.expander("エラー詳細"):
                st.code(f"{IMPORT_ERROR_MESSAGE}", language="text")
            st.caption("※ yfinance のインストールに失敗しています。時間をおいて再読み込みしてください。")
        
        if st.button("🔄 シグナル再生成", help="npm run signal（Node.js 環境用）"):
            with st.spinner("npm run signal 実行中..."):
                code, text = _run_npm_script("signal")
            if code == 0:
                st.success("完了")
            else:
                st.error(f"終了コード {code}")
            with st.expander("ログ"):
                st.code(text[:12000] or "(出力なし)", language="text")

    st.title("日米業種リードラグ戦略")
    st.warning(
        "教育・検証用です。利益や元本の保証はありません。実弾の前にペーパー運用と README の免責を確認してください。"
    )

    tab_sig, tab_bt, tab_paper, tab_files = st.tabs(
        ["シグナル", "バックテストCSV", "ペーパー", "results ファイル"]
    )

    with tab_sig:
        sig_path = res / "signal.json"
        raw = _load_json(sig_path)
        if not raw:
            st.info("`results/signal.json` がありません。サイドバーから「シグナル再生成」か、ターミナルで `npm run signal` を実行してください。")
        else:
            data = _ensure_signal_candidates(raw)
            c1, c2, c3 = st.columns(3)
            c1.metric("データ日", data.get("latestDate") or "—")
            c2.metric("λ", str((data.get("config") or {}).get("lambdaReg", "—")))
            c3.metric("窓 / 分位", f"{(data.get('config') or {}).get('windowLength', '—')} / {(data.get('config') or {}).get('quantile', '—')}")

            buys = pd.DataFrame(data.get("buyCandidates") or [])
            sells = pd.DataFrame(data.get("sellCandidates") or [])
            bc, sc = st.columns(2)
            with bc:
                st.subheader("ロング候補")
                if buys.empty:
                    st.write("—")
                else:
                    st.dataframe(
                        buys[["rank", "ticker", "name", "sector", "signal"]]
                        if "rank" in buys.columns
                        else buys,
                        use_container_width=True,
                        hide_index=True,
                    )
            with sc:
                st.subheader("ショート候補")
                if sells.empty:
                    st.write("—")
                else:
                    st.dataframe(
                        sells[["rank", "ticker", "name", "sector", "signal"]]
                        if "rank" in sells.columns
                        else sells,
                        use_container_width=True,
                        hide_index=True,
                    )

            if data.get("signals"):
                df_all = pd.DataFrame(data["signals"])
                st.subheader("全セクター シグナル")
                st.bar_chart(df_all.set_index("ticker")["signal"].sort_values())

    with tab_bt:
        st.caption("代表的なサマリ CSV。詳細は `npm run backtest` 等で更新。")
        choices = {
            "backtest_summary_real.csv": "メイン real バックテスト",
            "backtest_summary_risk_managed.csv": "リスク管理版",
            "backtest_summary_improved.csv": "improved グリッド",
            "cumulative_pca_sub.csv": "累積リターン PCA SUB",
            "cumulative_pca_plain.csv": "累積リターン PCA PLAIN",
            "cumulative_mom.csv": "累積リターン MOM",
        }
        pick = st.selectbox("ファイル", list(choices.keys()), format_func=lambda k: f"{k} — {choices[k]}")
        csv_path = res / pick
        if not csv_path.is_file():
            st.warning(f"存在しません: `{csv_path}`")
        else:
            try:
                df = pd.read_csv(csv_path)
                st.dataframe(df, use_container_width=True, hide_index=True)
            except Exception as e:
                st.error(f"読み込み失敗: {e}")

            if pick.startswith("cumulative_") and csv_path.is_file():
                try:
                    df_c = pd.read_csv(csv_path)
                    date_col = next(
                        (c for c in df_c.columns if "date" in c.lower() or c.lower() == "day"),
                        df_c.columns[0],
                    )
                    val_cols = [c for c in df_c.columns if c != date_col]
                    if val_cols:
                        st.subheader("累積カーブ（先頭の数値列）")
                        chart_df = df_c.set_index(date_col)[val_cols[0]]
                        st.line_chart(chart_df)
                except Exception:
                    pass

    with tab_paper:
        pv = _load_json(res / "paper_verification_status.json")
        pj = _load_json(res / "paper_journal.json")
        if pv:
            st.subheader("paper_verification_status.json")
            st.json(pv)
        else:
            st.info("`paper_verification_status.json` なし — `npm run paper` 実行後に表示されます。")
        if pj:
            st.subheader("paper_journal.json（要約）")
            entries = (pj.get("entries") or [])[-20:]
            st.caption(f"直近 {len(entries)} 件 / 全 {len((pj.get('entries') or []))} 件")
            st.json({"version": pj.get("version"), "startedAt": pj.get("startedAt"), "tail": entries})
        else:
            st.caption("`paper_journal.json` なし")

    with tab_files:
        st.caption("`results/` 内の JSON / CSV / MD（最大 80 件）")
        if not res.is_dir():
            st.error("results ディレクトリがありません")
        else:
            files = sorted(res.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:80]
            for f in files:
                if f.is_file():
                    st.text(f"{f.name}  ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
