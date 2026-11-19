"""Public build: runs inside Pyodide (static/js/local/pyworker.js). The browser's stand-in for the local server's
subprocesses: harness/snippet.py (try blocks, cards, help) and harness/grade.py (graders).

It imports those files unchanged (they are copied to /usaaio/py) and reuses their functions; only the parts that
need a separate process or SIGALRM are redone here. There is no SIGALRM in WebAssembly: time limits are enforced by
the page, which terminates and restarts this worker (it gets per-test progress events through `emit`).
Between runs it restores the working folder, sys.path and user modules, so each run starts like a fresh process.
"""
import base64
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import time

import warnings  # noqa: E402

os.environ["MPLBACKEND"] = "Agg"   # no DOM in a worker; figures are saved as PNG
# Pyodide-internal noise that would land in the student's output (threadpoolctl, imported by scikit-learn)
warnings.filterwarnings("ignore", message=".*as_object_map.*")
sys.path.insert(0, "/usaaio/py")
import harness  # noqa: E402  (unchanged harness/harness.py)
import snippet  # noqa: E402  (unchanged harness/snippet.py: run_user, short_tb)
import grade as G  # noqa: E402  (unchanged harness/grade.py: static_checks, friendly_error)

# Python here is WebAssembly NumPy, slower than native and unlike Colab's CPU, and the slowdown depends on the
# operation: measured on an M2 Pro, Python loops run about 1.6x slower than native, but a large matrix product about
# 70x slower (Pyodide's NumPy has no optimized BLAS). The slowest reference solution (u02-p08) needs 2.6x the
# official limit here, so budgets are the limit times 6, leaving room for slower computers. That keeps correct code
# from failing; the price is that moderately slow code (1.5-2x the limit) passes here. Colab's timing is what counts.
# harness.SPEED_FACTOR divides the limit, so it is set to 1/6 for graders that use it directly.
BROWSER_ALLOWANCE = 6.0
harness.SPEED_FACTOR = 1.0 / BROWSER_ALLOWANCE
_native_within = harness.within


def _within(seconds, fn, *args, **kwargs):
    """harness.within with the browser allowance and a message that says the limit is approximate here."""
    import copy
    t0 = time.perf_counter()
    out = fn(*args, **kwargs)
    dt = time.perf_counter() - t0
    budget = seconds * BROWSER_ALLOWANCE
    for _ in range(2):
        if dt <= budget:
            break
        a2, k2 = copy.deepcopy(args), copy.deepcopy(kwargs)
        t0 = time.perf_counter()
        fn(*a2, **k2)
        dt = min(dt, time.perf_counter() - t0)
    TIMINGS.append([seconds, round(dt, 4)])
    harness.need(dt <= budget, f"too slow: {dt:.2f} s in your browser, over the browser allowance of {budget:.2f} s "
                               f"for the official {seconds} s limit (approximate: Python here runs in WebAssembly; "
                               f"check the timing in Colab)")
    return out


harness.within = _within
TIMINGS = []   # [official limit, seconds] of each within() call in the current grade (tests calibrate the allowance)


def _pandas_int64(text):
    """WebAssembly is 32-bit, so NumPy's default integer (what Python's int maps to) is int32 here and int64 in Colab.
    pandas code taught for the exam writes .astype(int) and expects int64, so in the browser pandas' astype maps
    int and "int" to int64. Plain NumPy arrays keep int32 (the page says so)."""
    if "pandas" not in text:
        return
    from pandas.core.generic import NDFrame
    if getattr(NDFrame.astype, "_usaaio", False):
        return
    orig = NDFrame.astype

    def fix(d):
        if d is int or (isinstance(d, str) and d == "int"):
            return "int64"
        if isinstance(d, dict):
            return {k: fix(v) for k, v in d.items()}
        return d

    def astype(self, dtype, *args, **kwargs):
        return orig(self, fix(dtype), *args, **kwargs)
    astype._usaaio = True
    astype.__doc__ = orig.__doc__
    NDFrame.astype = astype

WORK = tempfile.gettempdir()   # the server runs snippets with cwd = the system temp dir (files persist between runs)
DATA = "/usaaio/data"          # pyworker.js writes each unit's data files to DATA/<uid>/ (fetched once)
_FILES_OK = ("/lib/", "/usr/")


def _snapshot():
    return os.getcwd(), list(sys.path), set(sys.modules)


def _restore(snap):
    cwd, path, mods = snap
    try:
        os.chdir(cwd)
    except OSError:
        pass
    sys.path[:] = path
    for name in list(sys.modules):
        if name in mods:
            continue
        f = getattr(sys.modules.get(name), "__file__", None) or ""
        if f and not f.startswith(_FILES_OK):   # a module the run wrote and imported: forget it, like a new process
            del sys.modules[name]
    try:
        import matplotlib.pyplot as plt
        plt.close("all")
    except Exception:  # noqa: BLE001
        pass


def _images():
    out = []
    try:
        if "matplotlib.pyplot" not in sys.modules:
            return out
        import matplotlib.pyplot as plt
        for num in plt.get_fignums():
            fig = plt.figure(num)
            b = io.BytesIO()
            fig.savefig(b, format="png", dpi=110, bbox_inches="tight")
            out.append(base64.b64encode(b.getvalue()).decode())
        plt.close("all")
    except Exception:  # noqa: BLE001
        pass
    return out


def run_snippet(req_json):
    """snippet.py main() for one request; returns the same JSON."""
    req = json.loads(req_json)
    out = {"ok": False, "stdout": "", "error": None, "images": [], "result_repr": None}
    buf = io.StringIO()
    snap = _snapshot()
    unit = req.get("unit")
    src = os.path.join(DATA, unit) if isinstance(unit, str) and unit.isalnum() else None
    work = snippet.fresh_workdir(src) if src and os.path.isdir(src) else None   # like snippet.py: a copy of the
    os.chdir(work or WORK)                                                      # unit's data/ folder, removed after
    ns = {"__name__": "__main__"}
    try:
        _pandas_int64(" ".join(str(req.get(k) or "") for k in ("setup", "code", "check", "help")))
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            if req.get("help"):
                pre = "import numpy as np\n" + ("import pandas as pd\n" if req["help"].startswith(("pd.", "pandas")) else "")
                exec(pre, ns)
                obj = eval(req["help"], ns)
                help(obj)
                out["ok"] = True
            else:
                if req.get("setup"):
                    exec(req["setup"], ns)
                code = req.get("code", "")
                has_result = snippet.run_user(code, ns) if code.strip() else False
                if has_result and ns.get("result") is not None and not req.get("check"):
                    print(repr(ns["result"]))
                if req.get("check"):
                    ns["src"] = code
                    if not has_result:
                        ns.setdefault("result", None)
                    exec(req["check"], ns)
                out["ok"] = True
    except AssertionError as e:
        out["error"] = "wrong answer" + (f": {e}" if str(e) else "")
    except SyntaxError as e:
        out["error"] = f"SyntaxError: {e.msg} (line {e.lineno})"
    except BaseException as e:  # noqa: BLE001
        out["error"] = snippet.short_tb(e)
    if "result" in ns and ns["result"] is not None:
        try:
            out["result_repr"] = repr(ns["result"])[:2000]
        except Exception:  # noqa: BLE001
            pass
    out["images"] = _images()
    out["stdout"] = buf.getvalue()[-8000:]
    _restore(snap)
    if work:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
    return json.dumps(out)


def run_grade(job_json, emit):
    """grade.py main() for one submission. emit(json) reports progress so the page can time each test."""
    job = json.loads(job_json)
    meta, pid, mode, code = job["meta"], job["pid"], job["mode"], job["code"]
    pdir = f"/usaaio/problems/{pid}"
    os.makedirs(pdir, exist_ok=True)
    for name, text in {"grader.py": job["grader"], **job.get("files", {})}.items():
        if name.endswith("::b64"):   # binary data file (e.g. .npz), base64 in the bundle
            with open(os.path.join(pdir, name[:-5]), "wb") as f:
                f.write(base64.b64decode(text))
            continue
        with open(os.path.join(pdir, name), "w", encoding="utf-8") as f:
            f.write(text)
    td = tempfile.mkdtemp(prefix="sub_")
    sub_path = os.path.join(td, meta.get("module_name", "submission") + ".py")
    with open(sub_path, "w", encoding="utf-8") as f:
        f.write(code)
    snap = _snapshot()
    os.chdir(td)
    result = {"ok": False, "static": [], "tests": [], "stdout": "", "error": None}
    TIMINGS.clear()
    try:
        _pandas_int64(code + job["grader"])
        result["static"] = G.static_checks(code, meta)
        if any(not s["ok"] and s["msg"].startswith("syntax") for s in result["static"]):
            return json.dumps(result)
        buf = io.StringIO()
        emit(json.dumps({"ev": "static", "static": result["static"]}))
        emit(json.dumps({"ev": "import"}))
        try:
            with contextlib.redirect_stdout(buf):
                spec = importlib.util.spec_from_file_location(meta.get("module_name", "submission"), sub_path)
                sub = importlib.util.module_from_spec(spec)
                sys.modules[spec.name] = sub
                spec.loader.exec_module(sub)
        except BaseException as e:  # noqa: BLE001
            result["error"] = "your file failed to import: " + G.friendly_error(e, pathlib_path(sub_path))
        if result["error"]:
            result["stdout"] = buf.getvalue()[-4000:]
            return json.dumps(result)
        entry = meta.get("entry")
        if entry and not hasattr(sub, entry):
            result["error"] = f"your file does not define {entry}"
            return json.dumps(result)
        sys.modules.pop("grader", None)
        gspec = importlib.util.spec_from_file_location("grader", os.path.join(pdir, "grader.py"))
        grader = importlib.util.module_from_spec(gspec)
        gspec.loader.exec_module(grader)
        visible = set(getattr(grader, "EXAMPLES", []))
        tests = [(n, f) for n, f in vars(grader).items() if n.startswith("test_") and callable(f)]
        run = [(n, f) for n, f in tests if mode != "run" or n in visible]
        emit(json.dumps({"ev": "tests", "tests": [{"name": n[5:].replace("_", " "), "visible": n in visible} for n, _ in run]}))
        for name, fn in run:
            rec = {"name": name[5:].replace("_", " "), "visible": name in visible, "passed": False, "msg": "", "seconds": 0.0}
            emit(json.dumps({"ev": "test", "name": rec["name"]}))
            t0 = time.perf_counter()
            try:
                with contextlib.redirect_stdout(buf):
                    fn(sub)
                rec["passed"] = True
            except harness.Fail as e:
                rec["msg"] = str(e)
            except BaseException as e:  # noqa: BLE001
                rec["msg"] = "your code raised " + G.friendly_error(e, pathlib_path(sub_path))
            rec["seconds"] = round(time.perf_counter() - t0, 3)
            result["tests"].append(rec)
            emit(json.dumps({"ev": "done", "rec": rec}))
        result["stdout"] = buf.getvalue()[-4000:]
        result["ok"] = all(s["ok"] for s in result["static"]) and bool(result["tests"]) and all(t["passed"] for t in result["tests"])
        if TIMINGS:
            result["timings"] = list(TIMINGS)
        if "within(" in job["grader"]:
            result["warnings"] = [f"Time limits are approximate in the browser: Python runs in WebAssembly, so each "
                                  f"limit here is {BROWSER_ALLOWANCE:g} times the official one. Colab's timing is what counts."]
        return json.dumps(result)
    finally:
        _restore(snap)
        sys.modules.pop(meta.get("module_name", "submission"), None)


def pathlib_path(p):
    import pathlib
    return pathlib.Path(p).resolve()
