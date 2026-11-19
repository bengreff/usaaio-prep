"""Make unit u13's practice dataset, fun_data/: a 1D regression task built like the official 2027 sample problem 5
("Learning an unknown function"), with a function of its own, so the official data is neither used nor published.

    python make_fun_data.py        # (re)writes fun_data/ next to this file; the output is the same every run

Layout (the same file names and JSON shapes as the sample):
    fun_data/train.json        {"x": [8000 numbers], "y": [8000 numbers]}
    fun_data/val_input.json    {"x": [400 numbers]}
    fun_data/val_answer.json   {"y": [400 numbers]}

x is uniform on [-1, 2] in both files. y = f(x) + noise, with Gaussian noise of standard deviation 0.1, so even the
true f has an expected squared error of 0.1 ** 2 = 0.01 on new points (the noise floor).

The lessons ask you to find the shape of f from a plot before you fit anything, so look at the plot before you read
f below.
"""
import json
from pathlib import Path

import numpy as np

SEED = 1307
N_TRAIN, N_VAL = 8000, 400
LOW, HIGH = -1.0, 2.0
NOISE_SD = 0.1


def f(x):
    """The unknown function: a wave with period 1.25, shifted up by 0.3."""
    return 0.3 + 0.8 * np.sin(2 * np.pi * x / 1.25 + 0.6)


def main():
    rng = np.random.default_rng(SEED)
    x = rng.uniform(LOW, HIGH, N_TRAIN)
    y = f(x) + rng.normal(0, NOISE_SD, N_TRAIN)
    x_val = rng.uniform(LOW, HIGH, N_VAL)
    y_val = f(x_val) + rng.normal(0, NOISE_SD, N_VAL)
    out = Path(__file__).resolve().parent / "fun_data"
    out.mkdir(exist_ok=True)
    for name, obj in [("train.json", {"x": x.tolist(), "y": y.tolist()}), ("val_input.json", {"x": x_val.tolist()}),
                      ("val_answer.json", {"y": y_val.tolist()})]:
        with open(out / name, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2)
    print(f"wrote {out}: {N_TRAIN} training and {N_VAL} validation points, x in [{LOW}, {HIGH}], noise sd {NOISE_SD}")


if __name__ == "__main__":
    main()
