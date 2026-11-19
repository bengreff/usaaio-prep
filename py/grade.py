"""Grade one submission in a child process. Prints one JSON line on stdout.

python -I grade.py <problem_dir> <submission.py> <run|submit>
"""
import ast
import contextlib
import importlib.util
import io
import json
import pathlib
import signal
import sys
import time
import traceback
import warnings

# scipy newer than scikit-learn 1.6.1 expects: harmless, and absent in Colab's pairing
warnings.filterwarnings("ignore", message=".*Unknown solver options: iprint.*")

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import Fail  # noqa: E402

ALWAYS_BANNED = {"__import__", "importlib", "exec", "eval", "compile"}
LOOP_NODES = (ast.For, ast.While, ast.AsyncFor, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


class Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise Timeout()


def static_checks(src, meta):
    """Return list of {"ok", "msg"}; mirrors the contest's import and function restrictions."""
    out = []
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [{"ok": False, "msg": f"syntax error on line {e.lineno}: {e.msg}"}]
    allowed = meta.get("allowed_imports", [])
    bad_imports = set()
    names_used = set()
    bare_names = set()  # plain identifiers and imported names (not attributes like model.eval)
    loops = []
    matmuls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if not any(a.name == m or a.name.startswith(m + ".") for m in allowed):
                    bad_imports.add(a.name)
                names_used.add(a.name.split(".")[-1])
                bare_names.update(a.name.split("."))
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if not any(mod == m or mod.startswith(m + ".") for m in allowed):
                bad_imports.add(mod)
            names_used.update(a.name for a in node.names)
            bare_names.update(a.name for a in node.names)
            bare_names.update(mod.split("."))
        elif isinstance(node, ast.Attribute):
            names_used.add(node.attr)
        elif isinstance(node, ast.Name):
            names_used.add(node.id)
            bare_names.add(node.id)
        if isinstance(node, LOOP_NODES):
            loops.append(getattr(node, "lineno", "?"))
        if isinstance(node, (ast.BinOp, ast.AugAssign)) and isinstance(node.op, ast.MatMult):
            matmuls.append(getattr(node, "lineno", "?"))
    if bad_imports:
        out.append({"ok": False, "msg": "import not allowed: " + ", ".join(sorted(bad_imports))
                    + f" (allowed: {', '.join(allowed) or 'nothing'})"})
    else:
        out.append({"ok": True, "msg": "imports allowed"})
    # problem bans match names and attributes (np.mean, X.mean); the always-banned builtins match bare names only,
    # so model.eval() and torch.compile stay legal while eval(...) and importlib do not
    hit = sorted((names_used & set(meta.get("banned", []))) | (bare_names & ALWAYS_BANNED))
    if hit:
        out.append({"ok": False, "msg": "uses banned name(s): " + ", ".join(hit)})
    else:
        out.append({"ok": True, "msg": "no banned functions"})
    if meta.get("ban_matmul_operator"):
        if matmuls:
            out.append({"ok": False, "msg": f"the @ operator is not allowed (line {matmuls[0]})"})
        else:
            out.append({"ok": True, "msg": "no @ operator"})
    if meta.get("ban_loops"):
        if loops:
            out.append({"ok": False, "msg": f"loops are not allowed (loop or comprehension on line {loops[0]})"})
        else:
            out.append({"ok": True, "msg": "no loops"})
    return out


def friendly_error(e, sub_path):
    """One-line description pointing at the line in Ben's file when possible."""
    tb = traceback.extract_tb(e.__traceback__)
    mine = [f for f in tb if f.filename == str(sub_path)]
    where = f" (your line {mine[-1].lineno}: {mine[-1].line})" if mine else ""
    return f"{type(e).__name__}: {e}{where}"


def main():
    prob = pathlib.Path(sys.argv[1])
    sub_path = pathlib.Path(sys.argv[2]).resolve()
    mode = sys.argv[3]
    meta = json.loads((prob / "meta.json").read_text())
    src = sub_path.read_text()
    result = {"ok": False, "static": [], "tests": [], "stdout": "", "error": None}
    result["static"] = static_checks(src, meta)
    if any(not s["ok"] and s["msg"].startswith("syntax") for s in result["static"]):
        print(json.dumps(result))
        return
    buf = io.StringIO()
    signal.signal(signal.SIGALRM, _alarm)
    per_test = float(meta.get("test_timeout_s", 20))
    try:
        with contextlib.redirect_stdout(buf):
            signal.setitimer(signal.ITIMER_REAL, per_test)
            spec = importlib.util.spec_from_file_location(meta.get("module_name", "submission"), sub_path)
            sub = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = sub
            spec.loader.exec_module(sub)
            signal.setitimer(signal.ITIMER_REAL, 0)
    except Timeout:
        result["error"] = f"importing your file took over {per_test:.0f} s"
    except BaseException as e:  # noqa: BLE001
        signal.setitimer(signal.ITIMER_REAL, 0)
        result["error"] = "your file failed to import: " + friendly_error(e, sub_path)
    if result["error"]:
        result["stdout"] = buf.getvalue()[-4000:]
        print(json.dumps(result))
        return
    entry = meta.get("entry")
    if entry and not hasattr(sub, entry):
        result["error"] = f"your file does not define {entry}"
        print(json.dumps(result))
        return
    gspec = importlib.util.spec_from_file_location("grader", prob / "grader.py")
    grader = importlib.util.module_from_spec(gspec)
    gspec.loader.exec_module(grader)
    visible = set(getattr(grader, "EXAMPLES", []))
    tests = [(n, f) for n, f in vars(grader).items() if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        if mode == "run" and name not in visible:
            continue
        rec = {"name": name[5:].replace("_", " "), "visible": name in visible, "passed": False, "msg": "", "seconds": 0.0}
        t0 = time.perf_counter()
        try:
            with contextlib.redirect_stdout(buf):
                signal.setitimer(signal.ITIMER_REAL, per_test)
                fn(sub)
                signal.setitimer(signal.ITIMER_REAL, 0)
            rec["passed"] = True
        except Timeout:
            rec["msg"] = f"took longer than {per_test:.0f} s (infinite loop, or far too slow)"
        except Fail as e:
            signal.setitimer(signal.ITIMER_REAL, 0)
            rec["msg"] = str(e)
        except BaseException as e:  # noqa: BLE001
            signal.setitimer(signal.ITIMER_REAL, 0)
            rec["msg"] = "your code raised " + friendly_error(e, sub_path)
        rec["seconds"] = round(time.perf_counter() - t0, 3)
        result["tests"].append(rec)
    result["stdout"] = buf.getvalue()[-4000:]
    result["ok"] = all(s["ok"] for s in result["static"]) and bool(result["tests"]) and all(t["passed"] for t in result["tests"])
    print(json.dumps(result))


if __name__ == "__main__":
    main()
