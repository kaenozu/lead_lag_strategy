"""stdout に JSON 1 行で PCA + シグナルを出力（Jest ゴールデン比較用）"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from subspace_pca import LeadLagSignal, SubspacePCAConfig, SubspaceRegularizedPCA  # noqa: E402

FIXTURE = {
    "returns_combined": [
        [0.01, 0.02, 0.015, 0.011],
        [0.02, 0.015, 0.01, 0.018],
        [-0.01, -0.005, -0.008, -0.012],
        [0.005, 0.008, 0.003, 0.006],
        [0.015, 0.012, 0.018, 0.014],
    ],
    "returns_us_latest": [0.012, 0.018],
    "C_full": [
        [1.0, 0.4, 0.2, 0.1],
        [0.4, 1.0, 0.15, 0.12],
        [0.2, 0.15, 1.0, 0.35],
        [0.1, 0.12, 0.35, 1.0],
    ],
    "sector_labels": {
        "US_A": "cyclical",
        "US_B": "defensive",
        "JP_A": "cyclical",
        "JP_B": "neutral",
    },
    "ordered_sector_keys": ["US_A", "US_B", "JP_A", "JP_B"],
    "lambda_reg": 0.85,
    "n_factors": 2,
}


def main() -> None:
    f = FIXTURE
    R = np.array(f["returns_combined"], dtype=float)
    n_us = 2
    ret_us = R[:, :n_us]
    ret_jp = R[:, n_us:]
    C_full = np.array(f["C_full"], dtype=float)
    labels = f["sector_labels"]
    ordered = f["ordered_sector_keys"]
    z = np.array(f["returns_us_latest"], dtype=float)

    cfg = SubspacePCAConfig(
        lambda_reg=f["lambda_reg"],
        n_factors=f["n_factors"],
        ordered_sector_keys=ordered,
    )

    mu = R.mean(axis=0)
    sigma = R.std(axis=0) + 1e-10
    Rstd = (R - mu) / sigma

    pca = SubspaceRegularizedPCA(cfg)
    _, ev, C_reg = pca.compute_regularized_pca(Rstd, labels, C_full)

    sig_gen = LeadLagSignal(cfg)
    signal = sig_gen.compute_signal(ret_us, ret_jp, z, labels, C_full)

    out = {
        "eigenvalues": ev.tolist(),
        "C_reg_first_row": C_reg[0].tolist(),
        "signal": signal.tolist(),
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
