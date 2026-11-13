"""Tests for scripts/check_property_tests.py. Each test commits a baseline in a
throwaway git repo, changes the working tree and checks what the script reports."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_property_tests.py"
_spec = importlib.util.spec_from_file_location("check_property_tests", SCRIPT)
cpt = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = cpt  # dataclasses look the module up by name
_spec.loader.exec_module(cpt)

PY_BASE = '''\
import pytest
from hypothesis import given, strategies as st


@given(st.integers())
def test_prop(n):
    assert n == n


def test_example():
    assert 1 == 1


class TestGroup:
    def test_in_class(self):
        assert True
'''

TS_BASE = '''\
import { describe, it, expect } from "vitest";
import fc from "fast-check";

describe("group", () => {
  it("holds for all ints", () => {
    fc.assert(fc.property(fc.integer(), (n) => n === n));
  });
  it("adds", () => {
    expect(1 + 1).toBe(2);
  });
});
'''

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.invalid",
}


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=GIT_ENV)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / "checker/tests").mkdir(parents=True)
    (tmp_path / "web/tests").mkdir(parents=True)
    (tmp_path / "checker/tests/test_a.py").write_text(PY_BASE)
    (tmp_path / "web/tests/a.test.ts").write_text(TS_BASE)
    (tmp_path / "checker/pyproject.toml").write_text("[tool.pytest.ini_options]\n")
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-q", "-m", "base")
    return tmp_path


def _edit(repo: Path, rel: str, old: str, new: str) -> None:
    path = repo / rel
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new, 1))


def _problems(repo: Path) -> list[str]:
    return cpt.find_problems(repo)


def test_unchanged_tree_passes(repo: Path) -> None:
    assert _problems(repo) == []
    assert cpt.main(["--repo", str(repo)]) == 0


def test_adding_a_test_passes(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "def test_example", "def test_new():\n    pass\n\n\ndef test_example")
    _edit(repo, "web/tests/a.test.ts", 'it("adds"', 'it("new one", () => {});\n  it("adds"')
    assert _problems(repo) == []


@pytest.mark.parametrize(
    "decorator, kind",
    [
        ('@pytest.mark.skip(reason="later")', "pytest.mark.skip"),
        ("@pytest.mark.skipif(True, reason='x')", "pytest.mark.skipif"),
        ("@pytest.mark.xfail", "pytest.mark.xfail"),
    ],
)
def test_new_python_skip_marker_fails(repo: Path, decorator: str, kind: str) -> None:
    _edit(repo, "checker/tests/test_a.py", "def test_example", f"{decorator}\ndef test_example")
    problems = _problems(repo)
    assert problems == [f"checker/tests/test_a.py: new {kind} on 'test_example'"]
    assert cpt.main(["--repo", str(repo)]) == 1


def test_pytest_skip_call_in_body_fails(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "    assert True", "    pytest.skip('no')\n    assert True")
    assert _problems(repo) == ["checker/tests/test_a.py: new pytest.skip( on 'TestGroup::test_in_class'"]


def test_module_level_pytestmark_fails(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "import pytest\n", "import pytest\npytestmark = pytest.mark.skip\n")
    assert _problems(repo) == ["checker/tests/test_a.py: new pytest.mark.skip on '<module>'"]


def test_removed_python_test_fails(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "def test_example():\n    assert 1 == 1\n", "")
    assert _problems(repo) == ["checker/tests/test_a.py: test 'test_example' removed or renamed"]


def test_deleted_test_file_fails(repo: Path) -> None:
    (repo / "checker/tests/test_a.py").unlink()
    assert sorted(_problems(repo)) == [
        "checker/tests/test_a.py: test 'TestGroup::test_in_class' file deleted",
        "checker/tests/test_a.py: test 'test_example' file deleted",
        "checker/tests/test_a.py: test 'test_prop' file deleted",
    ]


def test_moving_a_test_to_another_file_passes(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "def test_example():\n    assert 1 == 1\n", "")
    (repo / "checker/tests/test_b.py").write_text("def test_example():\n    assert 1 == 1\n")
    assert _problems(repo) == []


def test_removing_given_fails(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "@given(st.integers())\ndef test_prop(n):", "def test_prop(n=1):")
    assert _problems(repo) == [
        "checker/tests/test_a.py: test 'test_prop' lost its @given (no longer a property test)"
    ]


def test_needs_model_marker_and_deselection_pass(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "def test_example", "@pytest.mark.needs_model\ndef test_example")
    (repo / "checker/pyproject.toml").write_text(
        "[tool.pytest.ini_options]\naddopts = \"-m 'not needs_model'\"\n"
    )
    assert _problems(repo) == []


def test_skip_text_inside_a_string_is_not_a_skip(repo: Path) -> None:
    _edit(repo, "checker/tests/test_a.py", "    assert 1 == 1", '    assert "@pytest.mark.skip" != "x"')
    assert _problems(repo) == []


def test_new_untracked_file_with_skip_fails(repo: Path) -> None:
    (repo / "checker/tests/test_new.py").write_text(
        "import pytest\n\n@pytest.mark.xfail\ndef test_x():\n    pass\n"
    )
    assert _problems(repo) == ["checker/tests/test_new.py: new pytest.mark.xfail on 'test_x'"]


@pytest.mark.parametrize(
    "old, new, expected",
    [
        ('it("adds"', 'it.skip("adds"', "new skip on 'adds'"),
        ('it("adds"', 'it.todo("adds"', "new todo on 'adds'"),
        ('it("adds"', 'it.fails("adds"', "new fails on 'adds'"),
        ('it("adds"', 'xit("adds"', "new xit on 'adds'"),
        ('describe("group"', 'describe.skip("group"', "new skip on 'group'"),
        ('it("adds"', 'it.skipIf(process.env.CI)("adds"', "new skipIf on 'adds'"),
    ],
)
def test_new_ts_skip_fails(repo: Path, old: str, new: str, expected: str) -> None:
    _edit(repo, "web/tests/a.test.ts", old, new)
    assert _problems(repo) == [f"web/tests/a.test.ts: {expected}"]


def test_test_dot_skip_fails(repo: Path) -> None:
    _edit(repo, "web/tests/a.test.ts", 'it("adds"', 'test.skip("adds"')
    assert _problems(repo) == ["web/tests/a.test.ts: new skip on 'adds'"]


def test_removed_ts_test_fails(repo: Path) -> None:
    _edit(repo, "web/tests/a.test.ts", '  it("adds", () => {\n    expect(1 + 1).toBe(2);\n  });\n', "")
    assert _problems(repo) == ["web/tests/a.test.ts: test 'adds' removed or renamed"]


def test_removed_fc_assert_fails(repo: Path) -> None:
    _edit(
        repo,
        "web/tests/a.test.ts",
        "fc.assert(fc.property(fc.integer(), (n) => n === n));",
        "expect(1).toBe(1);",
    )
    assert _problems(repo) == ["web/tests/a.test.ts: fc.assert calls dropped from 1 to 0"]


def test_unparseable_python_file_fails(repo: Path) -> None:
    (repo / "checker/tests/test_a.py").write_text(PY_BASE + "\ndef broken(:\n")
    problems = _problems(repo)
    assert "checker/tests/test_a.py: could not parse file, so its tests can't be checked" in problems


def test_bad_base_ref_is_a_git_error(repo: Path) -> None:
    assert cpt.main(["--repo", str(repo), "--base", "no-such-ref"]) == 2
