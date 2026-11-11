"""Run the pytest file that matches a saved file in checker/src/checks/.

    uv run python scripts/run_matching_test.py [saved-path]

Used by the PostFileSave hook `.kiro/hooks/checker-test-on-save.json` (task 20).
Kiro passes the hook event as JSON on stdin; the saved path is taken from the
first argument if given, otherwise from that JSON.

`checks/<name>.py` runs `tests/test_<name>.py` when it exists, for example
`p2_sentence_length.py` runs `tests/test_p2_sentence_length.py`. Anything else
(`config.py`, `models.py`, the word list, or no path at all) runs the full suite.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

CHECKER_DIR = Path(__file__).resolve().parents[1]
CHECKS_MARKER = "src/checks/"
PATH_KEYS = ("file_path", "filePath", "path", "file", "files", "paths")


def _find_path(value: object) -> str | None:
    """Return the first string in the event JSON that points into src/checks/."""
    if isinstance(value, str):
        return value if CHECKS_MARKER in value.replace("\\", "/") else None
    if isinstance(value, dict):
        ordered = [value[k] for k in PATH_KEYS if k in value]
        ordered += [v for k, v in value.items() if k not in PATH_KEYS]
        for v in ordered:
            if (found := _find_path(v)) is not None:
                return found
    if isinstance(value, list):
        for v in value:
            if (found := _find_path(v)) is not None:
                return found
    return None


def saved_path(argv: list[str], stdin_text: str | None) -> str | None:
    if argv:
        return argv[0]
    if not stdin_text or not stdin_text.strip():
        return None
    try:
        return _find_path(json.loads(stdin_text))
    except json.JSONDecodeError:
        return _find_path(stdin_text.strip())


def matching_test(path: str | None, checker_dir: Path = CHECKER_DIR) -> str | None:
    """Return the test file (relative to checker/) for a saved path, or None for the full suite."""
    if not path:
        return None
    p = path.replace("\\", "/")
    if CHECKS_MARKER not in p:
        return None
    rel = p.split(CHECKS_MARKER, 1)[1]
    if "/" in rel or not rel.endswith(".py"):
        return None
    candidate = f"tests/test_{rel[:-3]}.py"
    return candidate if (checker_dir / candidate).is_file() else None


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    stdin_text = None if sys.stdin is None or sys.stdin.isatty() else sys.stdin.read()
    target = matching_test(saved_path(argv, stdin_text))
    cmd = [sys.executable, "-m", "pytest", "-q"] + ([target] if target else [])
    print(f"running: pytest {target or '(full suite)'}", flush=True)
    return subprocess.run(cmd, cwd=CHECKER_DIR).returncode


if __name__ == "__main__":
    raise SystemExit(main())
