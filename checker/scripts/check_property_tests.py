"""Fail if a test was skipped, xfailed or removed compared with a git commit.

    uv run python scripts/check_property_tests.py [--repo PATH] [--base REF]

Used by the PostTaskExec hook `.kiro/hooks/check-property-tests.json` (task 20).
It compares the working tree (tracked and untracked, not ignored) with `REF`
(default `HEAD`) in `checker/tests/` and `web/tests/`, and reports:

- test functions or `it`/`test` cases that were removed or renamed
- new skip markers: `@pytest.mark.skip`, `skipif`, `xfail`, `pytest.skip(`,
  `pytest.xfail(`, `pytest.importorskip(`, `unittest.skip*`, and in TypeScript
  `.skip`, `.skipIf`, `.runIf`, `.todo`, `.fails`, `.only`, `xit`, `xtest`,
  `xdescribe`
- Python tests that lost their `@given` decorator, and TypeScript files with
  fewer `fc.assert(` calls

Deselecting with a marker (`needs_model`, `-m 'not needs_model'` in
pyproject.toml) is not a skip and is not reported.

Output names files, test names and marker kinds only, never file contents.
Exit code 0 when clean, 1 when anything is reported, 2 on a git error.
"""

from __future__ import annotations

import argparse
import ast
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

TEST_DIRS = ("checker/tests", "web/tests")
PY_SUFFIXES = (".py",)
TS_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs")

# Last part of a dotted decorator or call that skips or xfails a test.
PY_MARK_KINDS = {"skip", "skipif", "xfail"}
PY_CALL_KINDS = {"pytest.skip", "pytest.xfail", "pytest.importorskip"}
PY_UNITTEST_KINDS = {"skip", "skipIf", "skipUnless", "expectedFailure"}

TS_TITLE = r"""\s*\(\s*(?P<q>["'`])(?P<title>(?:\\.|(?!(?P=q)).)*)(?P=q)"""
# Condition call of `.skipIf(cond)` / `.runIf(cond)`: parentheses not starting with a quote.
TS_COND = r"""(?:\((?!\s*["'`])[^)]*\))?"""
TS_TEST_RE = re.compile(r"\b(?:x?it|x?test)(?:\.\w+)*" + TS_COND + TS_TITLE)
TS_MODIFIER_RE = re.compile(
    r"\b(?:it|test|describe|suite)(?:\.\w+)*\."
    r"(?P<kind>skip|skipIf|runIf|todo|fails|only)\b" + TS_COND + r"(?:" + TS_TITLE + r")?"
)
TS_XFUNC_RE = re.compile(r"\b(?P<kind>xit|xtest|xdescribe)" + TS_TITLE)
TS_FC_ASSERT_RE = re.compile(r"\bfc\.assert\s*\(")


@dataclass
class FileFacts:
    tests: Counter[str] = field(default_factory=Counter)
    skips: Counter[tuple[str, str]] = field(default_factory=Counter)
    given: set[str] = field(default_factory=set)
    fc_asserts: int = 0
    parse_error: bool = False


# ---------------------------------------------------------------- Python


def _dotted(node: ast.AST) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _skip_kind(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Attribute):
        return None
    name = _dotted(node)
    if name is None:
        return None
    parts = name.split(".")
    if len(parts) >= 2 and parts[-2] == "mark" and parts[-1] in PY_MARK_KINDS:
        return f"pytest.mark.{parts[-1]}"
    if name in PY_CALL_KINDS:
        return f"{name}("
    if len(parts) >= 2 and parts[-2] == "unittest" and parts[-1] in PY_UNITTEST_KINDS:
        return name
    return None


def _decorator_name(node: ast.AST) -> str | None:
    return _dotted(node.func if isinstance(node, ast.Call) else node)


class _PyVisitor(ast.NodeVisitor):
    def __init__(self, facts: FileFacts) -> None:
        self.facts = facts
        self.scope: list[str] = []

    def _scope_name(self) -> str:
        return "::".join(self.scope) or "<module>"

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    def _visit_func(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.scope.append(node.name)
        if node.name.startswith("test"):
            qualified = self._scope_name()
            self.facts.tests[qualified] += 1
            if any(
                (_decorator_name(d) or "").split(".")[-1] == "given"
                for d in node.decorator_list
            ):
                self.facts.given.add(qualified)
        self.generic_visit(node)
        self.scope.pop()

    visit_FunctionDef = _visit_func
    visit_AsyncFunctionDef = _visit_func

    def visit_Attribute(self, node: ast.Attribute) -> None:
        kind = _skip_kind(node)
        if kind is not None:
            self.facts.skips[(self._scope_name(), kind)] += 1
            return  # don't count inner parts of the same chain
        self.generic_visit(node)


def python_facts(source: str) -> FileFacts:
    facts = FileFacts()
    try:
        tree = ast.parse(source)
    except SyntaxError:
        facts.parse_error = True
        return facts
    _PyVisitor(facts).visit(tree)
    return facts


# ------------------------------------------------------------ TypeScript


def ts_facts(source: str) -> FileFacts:
    facts = FileFacts()
    for m in TS_TEST_RE.finditer(source):
        facts.tests[m.group("title")] += 1
    for regex in (TS_MODIFIER_RE, TS_XFUNC_RE):
        for m in regex.finditer(source):
            scope = m.group("title") or "<file>"
            facts.skips[(scope, m.group("kind"))] += 1
    facts.fc_asserts = len(TS_FC_ASSERT_RE.findall(source))
    return facts


# ------------------------------------------------------------------- git


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _is_test_file(path: str) -> bool:
    if path.startswith("checker/tests/"):
        return path.endswith(PY_SUFFIXES)
    if path.startswith("web/tests/"):
        return path.endswith(TS_SUFFIXES)
    return False


def _facts_for(path: str, source: str) -> FileFacts:
    return python_facts(source) if path.endswith(PY_SUFFIXES) else ts_facts(source)


def find_problems(repo: Path, base: str = "HEAD") -> list[str]:
    old_paths = {
        p
        for p in _git(repo, "ls-tree", "-r", "--name-only", base, "--", *TEST_DIRS).splitlines()
        if _is_test_file(p)
    }
    new_paths = {
        p
        for p in _git(
            repo, "ls-files", "--cached", "--others", "--exclude-standard", "--", *TEST_DIRS
        ).splitlines()
        if _is_test_file(p) and (repo / p).is_file()
    }

    old: dict[str, FileFacts] = {
        p: _facts_for(p, _git(repo, "show", f"{base}:{p}")) for p in sorted(old_paths)
    }
    new: dict[str, FileFacts] = {}
    problems: list[str] = []
    for p in sorted(new_paths):
        try:
            source = (repo / p).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            problems.append(f"{p}: could not read file")
            continue
        new[p] = _facts_for(p, source)
        if new[p].parse_error:
            problems.append(f"{p}: could not parse file, so its tests can't be checked")

    # Removed tests. Matched by name across all files, so moving a test to
    # another file is fine; renaming it is reported.
    for lang_suffixes in (PY_SUFFIXES, TS_SUFFIXES):
        old_total: Counter[str] = Counter()
        new_total: Counter[str] = Counter()
        origin: dict[str, str] = {}
        for p, f in old.items():
            if p.endswith(lang_suffixes):
                old_total.update(f.tests)
                for name in f.tests:
                    origin.setdefault(name, p)
        for p, f in new.items():
            if p.endswith(lang_suffixes):
                new_total.update(f.tests)
        for name, count in sorted((old_total - new_total).items()):
            where = origin[name]
            gone = "file deleted" if where not in new else "removed or renamed"
            times = f" ({count}x)" if count > 1 else ""
            problems.append(f"{where}: test '{name}' {gone}{times}")

    for p, f in new.items():
        before = old.get(p, FileFacts())
        for (scope, kind), count in sorted((f.skips - before.skips).items()):
            times = f" ({count}x)" if count > 1 else ""
            problems.append(f"{p}: new {kind} on '{scope}'{times}")
        for name in sorted(before.given - f.given):
            if name in f.tests:
                problems.append(f"{p}: test '{name}' lost its @given (no longer a property test)")
        if f.fc_asserts < before.fc_asserts:
            problems.append(
                f"{p}: fc.assert calls dropped from {before.fc_asserts} to {f.fc_asserts}"
            )

    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", type=Path, default=None, help="repository root")
    parser.add_argument("--base", default="HEAD", help="commit to compare with")
    args = parser.parse_args(argv)

    start = args.repo or Path(__file__).resolve().parent
    try:
        repo = Path(_git(start, "rev-parse", "--show-toplevel").strip())
        _git(repo, "rev-parse", "--verify", "--quiet", f"{args.base}^{{commit}}")
    except subprocess.CalledProcessError as exc:
        print(f"check_property_tests: git error: {exc.stderr.strip()}", file=sys.stderr)
        return 2

    problems = find_problems(repo, args.base)
    if problems:
        print(
            f"Property test check FAILED against {args.base}. "
            "Never skip, xfail or delete a test to make a run pass:",
            file=sys.stderr,
        )
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        return 1
    print(f"Property test check passed: no tests skipped, xfailed or removed since {args.base}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
