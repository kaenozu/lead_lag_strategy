"""リポジトリルート解決（どの cwd で streamlit を起動しても results を指す）"""
from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def results_dir() -> Path:
    return repo_root() / "results"
