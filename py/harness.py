"""Helpers that problem graders import (`from harness import *`).

A grader is content/units/<unit>/problems/<pid>/grader.py. It defines test functions named test_* that take the
submission module `sub`. EXAMPLES lists the test names shown on Run (visible); Submit runs every test.
Failures raise Fail with a message written for Ben: say what was wrong, never dump hidden inputs.
"""
import copy
import time

import numpy as np

# Colab CPUs are slower than Ben's M2 Pro, so local timings must beat the official limit by this factor.
# 2.0 is a guess (Colab single-thread speed is roughly half an M2 core); revisit if Ben reports Colab timeouts.
SPEED_FACTOR = 2.0


class Fail(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Fail(msg)


def _np(x):
    try:
        import torch
        if isinstance(x, torch.Tensor):
            return x.detach().cpu().numpy()
    except ImportError:
        pass
    return np.asarray(x)


def shape(got, want, what="result"):
    s = tuple(_np(got).shape)
    need(s == tuple(want), f"{what} has shape {s}, expected {tuple(want)}")


def close(got, want, what="result", rtol=1e-6, atol=1e-8):
    g, w = _np(got).astype(float), _np(want).astype(float)
    need(g.shape == w.shape, f"{what} has shape {tuple(g.shape)}, expected {tuple(w.shape)}")
    need(np.isfinite(g).all() or not np.isfinite(w).all(), f"{what} contains nan or inf")
    if not np.allclose(g, w, rtol=rtol, atol=atol):
        err = float(np.max(np.abs(g - w))) if g.size else 0.0
        raise Fail(f"{what} has wrong values (largest error {err:.3g})")


def equal(got, want, what="result"):
    if isinstance(want, (np.ndarray,)) or hasattr(want, "shape"):
        g, w = _np(got), _np(want)
        need(g.shape == w.shape, f"{what} has shape {tuple(g.shape)}, expected {tuple(w.shape)}")
        need(np.array_equal(g, w), f"{what} has wrong values")
    else:
        need(got == want, f"{what} is {got!r}, expected {want!r}")


def is_type(got, types, what="result"):
    need(isinstance(got, types), f"{what} has type {type(got).__name__}, expected {getattr(types, '__name__', types)}")


def _snapshot(x):
    try:
        import torch
        if isinstance(x, torch.Tensor):
            return x.detach().clone()
    except ImportError:
        pass
    if hasattr(x, "copy") and not isinstance(x, (dict, list)):
        try:
            return x.copy(deep=True)
        except TypeError:
            return x.copy()
    return copy.deepcopy(x)


def _same(a, b):
    try:
        import torch
        if isinstance(a, torch.Tensor):
            return torch.equal(a, b)
    except ImportError:
        pass
    if hasattr(a, "equals"):
        return a.equals(b)
    if isinstance(a, np.ndarray):
        return a.shape == b.shape and np.array_equal(a, b, equal_nan=True)
    return a == b


def no_mutation(fn, *args, **kwargs):
    """Call fn and fail if it changed any argument in place."""
    snaps = [_snapshot(a) for a in args]
    out = fn(*args, **kwargs)
    for i, (a, s) in enumerate(zip(args, snaps)):
        need(_same(a, s), f"your code modified input argument #{i + 1}; work on a copy instead")
    return out


def within(seconds, fn, *args, **kwargs):
    """Call fn; fail if it is slower than the official limit allows (scaled for Colab's slower CPU).

    Other programs on this Mac can slow a single run, so an over-budget run is re-timed up to twice on copies of
    the arguments and the fastest time counts. The first call's result is returned."""
    t0 = time.perf_counter()
    out = fn(*args, **kwargs)
    dt = time.perf_counter() - t0
    budget = seconds / SPEED_FACTOR
    for _ in range(2):
        if dt <= budget:
            break
        a2, k2 = copy.deepcopy(args), copy.deepcopy(kwargs)
        t0 = time.perf_counter()
        fn(*a2, **k2)
        dt = min(dt, time.perf_counter() - t0)
    need(dt <= budget, f"too slow: {dt:.2f} s here; Colab is slower, so you need under {budget:.2f} s locally "
                       f"to be safe against the {seconds} s limit")
    return out


def rng(seed):
    return np.random.default_rng(seed)
