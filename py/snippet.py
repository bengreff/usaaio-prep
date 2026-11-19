"""Run a code snippet (lesson "try" blocks, API recall cards, help()). Reads JSON on stdin, prints one JSON line.

Input:  {"code": str, "setup": str (optional), "check": str (optional), "help": str (optional),
         "unit": str (optional, a lesson's unit id such as "u13")}
Output: {"ok": bool, "stdout": str, "error": str|None, "images": [base64 png], "result_repr": str|None}

Unit data: if content/units/<unit>/data/ exists, the code runs in a fresh temporary folder that holds a copy of it
(removed afterwards), so a lesson opens its files by relative path, e.g. Path("fun_data") / "train.json", as a
student does after uploading the same files to Colab. USAAIO_CONTENT overrides the content folder, as for server.py.

Cards: setup runs first, then Ben's code. If the last statement of his code is an expression, its value is bound
to `result`. Then `check` runs with `result`, `src` (his code text) and every name his code defined; a failed
assert in check means a wrong answer.
"""
import ast
import base64
import contextlib
import io
import json
import os
import pathlib
import re
import shutil
import signal
import sys
import tempfile
import traceback
import warnings

# scipy newer than scikit-learn 1.6.1 expects: harmless, and absent in Colab's pairing
warnings.filterwarnings("ignore", message=".*Unknown solver options: iprint.*")


def _alarm(signum, frame):
    raise TimeoutError("ran longer than 15 s")


def unit_data_dir(unit):
    """content/units/<unit>/data if the unit has one, else None."""
    if not isinstance(unit, str) or not re.fullmatch(r"u\d{2}", unit):
        return None
    content = os.environ.get("USAAIO_CONTENT") or pathlib.Path(__file__).resolve().parents[1] / "content"
    d = pathlib.Path(content) / "units" / unit / "data"
    return d if d.is_dir() else None


def fresh_workdir(src):
    """A new temporary folder holding a copy of the folder src (the browser runner, runner.py, reuses this)."""
    work = tempfile.mkdtemp(prefix="usaaio_run_")
    shutil.copytree(src, work, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store", "*.pyc"))
    return work


def run_user(code, ns):
    tree = ast.parse(code, "<your code>", "exec")
    last = tree.body[-1] if tree.body else None
    if isinstance(last, ast.Expr):
        tree.body = tree.body[:-1]
        exec(compile(tree, "<your code>", "exec"), ns)
        ns["result"] = eval(compile(ast.Expression(last.value), "<your code>", "eval"), ns)
        return True
    exec(compile(tree, "<your code>", "exec"), ns)
    return False


def short_tb(e):
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "<your code>"]
    where = f" (line {frames[-1].lineno})" if frames else ""
    return f"{type(e).__name__}: {e}{where}"


def main():
    req = json.loads(sys.stdin.read())
    out = {"ok": False, "stdout": "", "error": None, "images": [], "result_repr": None}
    buf = io.StringIO()
    signal.signal(signal.SIGALRM, _alarm)
    signal.setitimer(signal.ITIMER_REAL, 15)
    try:
        import matplotlib
        matplotlib.use("Agg")
    except ImportError:
        pass
    ns = {"__name__": "__main__"}
    data = unit_data_dir(req.get("unit"))
    work = fresh_workdir(data) if data else None
    if work:
        os.chdir(work)
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            if req.get("help"):
                exec("import numpy as np\nimport pandas as pd\nimport torch\nimport torch.nn as nn\n"
                     "import torch.nn.functional as F", ns)
                obj = eval(req["help"], ns)
                help(obj)
                out["ok"] = True
            else:
                if req.get("setup"):
                    exec(req["setup"], ns)
                code = req.get("code", "")
                has_result = run_user(code, ns) if code.strip() else False
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
        out["error"] = short_tb(e)
    signal.setitimer(signal.ITIMER_REAL, 0)
    if "result" in ns and ns["result"] is not None:
        try:
            out["result_repr"] = repr(ns["result"])[:2000]
        except Exception:  # noqa: BLE001
            pass
    try:
        import matplotlib.pyplot as plt
        for num in plt.get_fignums():
            fig = plt.figure(num)
            b = io.BytesIO()
            fig.savefig(b, format="png", dpi=110, bbox_inches="tight")
            out["images"].append(base64.b64encode(b.getvalue()).decode())
        plt.close("all")
    except Exception:  # noqa: BLE001
        pass
    out["stdout"] = buf.getvalue()[-8000:]
    if work:
        shutil.rmtree(work, ignore_errors=True)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
