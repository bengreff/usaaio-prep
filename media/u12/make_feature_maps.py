"""Make feature-maps-practice.png for lesson u12-l05: a drawn street scene and five shuffled "feature maps", one per
ResNet depth (layer 0 to layer 4), for practicing the 2026 Round 1 Problem 6 skill.

    python make_feature_maps.py      # writes feature-maps-practice.png next to this file (same output every run)

The maps are an illustration made by hand, not the output of a trained network. Each one copies what a pretrained
ResNet's maps look like at that depth for a 224 by 224 input, at the real resolution of that stage:
  layer 0 (112 x 112): a brightness filter, so the map is a dimmed copy of the scene;
  layer 1 (56 x 56): an edge filter, so outlines, perspective lines and fine texture;
  layer 2 (28 x 28): local pattern energy, so a dense field of small blobs;
  layer 3 (14 x 14): a few object parts (the robot's head, the tree's crown, the window), so a few separate blobs;
  layer 4 (7 x 7): the main object, so one smooth blob over the robot.
Every map is shown enlarged to the image size, which is what makes the coarse ones look blurry.
"""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from scipy.ndimage import zoom  # noqa: E402

N = 224
ORDER = {"A": 3, "B": 1, "C": 4, "D": 0, "E": 2}   # panel letter -> layer (the answer key is in the lesson)
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:N, 0:N].astype(float)


def scene():
    """RGB image in [0, 1] and masks of the parts the deep maps respond to."""
    img = np.zeros((N, N, 3))
    sky = (yy < 120)[..., None]
    img += sky * np.stack([0.55 + 0.3 * yy / 120, 0.7 + 0.2 * yy / 120, np.full_like(yy, 0.95)], -1)
    ground = ~sky[..., 0]
    img[ground] = [0.35, 0.55, 0.3]
    img[ground] += 0.08 * rng.normal(size=(ground.sum(), 1))           # grass texture
    road = ground & (np.abs(xx - 112) < 20 + (yy - 120) * 0.9)          # a road in perspective
    img[road] = 0.42 + 0.05 * rng.normal(size=(road.sum(), 1))
    dash = road & (np.abs(xx - 112) < 1.5 + (yy - 120) * 0.03) & (((yy - 120) // 9) % 2 == 0)
    img[dash] = 0.95
    sun = (xx - 190) ** 2 + (yy - 30) ** 2 < 15 ** 2
    img[sun] = [1.0, 0.85, 0.3]
    house = (xx > 15) & (xx < 75) & (yy > 80) & (yy < 135)
    img[house] = [0.75, 0.45, 0.35]
    bricks = house & (((yy % 8) < 1) | ((((yy // 8) % 2) * 6 + xx) % 12 < 1))
    img[bricks] = [0.5, 0.3, 0.25]
    roof = (yy > 55) & (yy <= 80) & (np.abs(xx - 45) < (yy - 55) * 1.3)
    img[roof] = [0.35, 0.2, 0.2]
    window = (xx > 25) & (xx < 41) & (yy > 92) & (yy < 108)
    img[window] = [0.95, 0.9, 0.55]
    trunk = (np.abs(xx - 190) < 5) & (yy > 95) & (yy < 135)
    img[trunk] = [0.4, 0.28, 0.15]
    crown = (xx - 190) ** 2 + (yy - 85) ** 2 < 22 ** 2
    img[crown] = [0.2, 0.5, 0.2]
    img[crown] += 0.1 * rng.normal(size=(crown.sum(), 1))
    # the robot in the middle of the road, arms raised
    body = (np.abs(xx - 112) < 14) & (yy > 130) & (yy < 172)
    head = (np.abs(xx - 112) < 10) & (yy > 110) & (yy < 129)
    eyes = ((xx - 107) ** 2 + (yy - 118) ** 2 < 6) | ((xx - 117) ** 2 + (yy - 118) ** 2 < 6)
    arms = ((np.abs(xx - 91) < 3) | (np.abs(xx - 133) < 3)) & (yy > 104) & (yy < 140)
    hands = ((xx - 91) ** 2 + (yy - 102) ** 2 < 25) | ((xx - 133) ** 2 + (yy - 102) ** 2 < 25)
    shoulders = (np.abs(yy - 137) < 3) & (np.abs(xx - 112) < 22)
    legs = ((np.abs(xx - 104) < 4) | (np.abs(xx - 120) < 4)) & (yy >= 172) & (yy < 195)
    robot = body | head | arms | hands | shoulders | legs
    img[robot] = [0.85, 0.75, 0.2]
    img[eyes] = 0.1
    parts = {"head": head, "crown": crown, "window": window}
    return np.clip(img, 0, 1), robot, parts


def pool(a, k, how="mean"):
    """k x k pooling of a square array."""
    m = a.reshape(a.shape[0] // k, k, a.shape[1] // k, k)
    return m.max(axis=(1, 3)) if how == "max" else m.mean(axis=(1, 3))


def blur(a, s):
    """Gaussian blur with standard deviation s pixels (separable, edges padded)."""
    r = int(3 * s) + 1
    g = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * s * s))
    g /= g.sum()
    p = np.pad(a, r, mode="edge")
    p = np.apply_along_axis(lambda v: np.convolve(v, g, mode="valid"), 0, p)
    return np.apply_along_axis(lambda v: np.convolve(v, g, mode="valid"), 1, p)


def part_blob(mask):
    """One blob per connected piece of a part mask, at 14 x 14: peak 1 at each piece's center."""
    out = np.zeros((14, 14))
    cols = np.where(mask.any(axis=0))[0]
    for piece in np.split(cols, np.where(np.diff(cols) > 1)[0] + 1):     # pieces separated left to right
        m = mask & (xx >= piece[0]) & (xx <= piece[-1])
        cy, cx = yy[m].mean() / 16 - 0.5, xx[m].mean() / 16 - 0.5
        gy_, gx_ = np.mgrid[0:14, 0:14]
        out = np.maximum(out, np.exp(-((gy_ - cy) ** 2 + (gx_ - cx) ** 2) / (2 * 0.6 ** 2)))
    return out


def norm(a):
    return (a - a.min()) / (a.max() - a.min())


def main():
    img, robot, parts = scene()
    lum = img @ np.array([0.3, 0.59, 0.11])
    gy, gx = np.gradient(lum)
    edges = np.hypot(gx, gy)
    maps = {
        0: norm(pool(0.6 * lum + 0.1 * img[..., 2], 2)),                                  # 112 x 112
        1: norm(np.sqrt(pool(edges, 4, "max"))),                                          # 56 x 56
        2: norm(np.maximum(np.sqrt(pool(edges, 8)) * (1 + 2.5 * blur(rng.normal(size=(28, 28)), 0.8)), 0)),  # 28 x 28
        3: norm(sum(w * part_blob(parts[k]) for k, w in [("head", 1.0), ("crown", 0.7), ("window", 0.6)])),  # 14 x 14
        4: norm(pool(blur(robot.astype(float), 18), 32)),                                 # 7 x 7
    }
    fig, axes = plt.subplots(2, 3, figsize=(7.2, 5.1), dpi=130)   # two rows, so each map stays large in a lesson
    axes = axes.ravel()
    axes[0].imshow(img, interpolation="antialiased")
    axes[0].set_title("Input image", fontsize=10)
    for ax, (letter, layer) in zip(axes[1:], ORDER.items()):
        m = maps[layer]
        if m.shape[0] <= 28:   # enlarge the coarse maps smoothly to the image size, as a display tool would
            m = np.clip(zoom(m, N / m.shape[0], order=3), 0, None)
        ax.imshow(np.minimum(m, np.percentile(m, 99.5)), cmap="Blues", extent=(0, N, N, 0), interpolation="antialiased")
        ax.set_title(f"({letter})", fontsize=10)
    for ax in axes:
        ax.set_xticks([])
        ax.set_yticks([])
        for s in ax.spines.values():
            s.set_color("#999999")
    fig.tight_layout(pad=0.4, h_pad=1.6)
    out = Path(__file__).resolve().parent / "feature-maps-practice.png"
    fig.savefig(out, facecolor="white", bbox_inches="tight", pad_inches=0.08)
    print("wrote", out, {k: v.shape for k, v in maps.items()})


if __name__ == "__main__":
    main()
