"""Pipeline property (task 30, design "Testing Strategy", "Pipeline property").

Requirements, Correctness Properties, "Property-based testing" item 2:

    "A generator SHALL produce synthetic letters with random dates, amounts,
    reference numbers, and long, passive sentences. For every generated
    letter, the pipeline's output SHALL satisfy P1 to P8."

Wiring. Hypothesis drives: each example is a `synthetic_letters()` letter
(task 11), posted to the running web app's `POST /api/convert`, which runs the
real pipeline (rewrite, check, regenerate, judge). The returned lines are then
checked again here, in process, with `check_easy_read` against key facts taken
from the Original by `analyse`, so the property doesn't rely on the pipeline's
own report. It needs the web app (WEB_URL, default http://localhost:3000) and
the checker service it calls, plus model keys, so it is marked `needs_model`
and deselected by default (`addopts` in pyproject.toml):

    cd checker && uv run pytest -m needs_model     # or: cd web && npm run fixtures:property

Deselection is not a skip or xfail: the test is never marked skip, and when
it runs, a missing web app or provider is a failure, not a skip.

What "satisfy P1 to P8" means here, read strictly:
- `passed`: every one of P1 to P8 passes, in the pipeline's report and here.
- `flagged`: allowed only when every flagged rule is P9 or P10. A flagged P2
  to P8 is output shown with a P1 to P8 failure, so it fails the property.
- `blocked`: fails the property. Blocking (R2.5) is the safe response to a P1
  failure, but it means the pipeline gave no output that satisfies P1.
- Any pipeline error (model output invalid, internal) fails the property.
- Provider or quota errors (429, 503, providers_unavailable) are not a
  counterexample, but they still fail the run with `ProviderUnavailable`, so a
  run cut short by limits is never reported as passing.

Settings and why:
- `max_examples` 5 by default (PIPELINE_PROPERTY_EXAMPLES): each example is
  a full conversion, several model calls on free tiers.
- `deadline=None`: one conversion takes 10 to 60 seconds.
- No shrink phase: shrinking would send many more letters to a live,
  nondeterministic model, burning quota and giving flaky minimal examples.
  The falsifying letter is still printed (it is invented text). Results are
  memoised per letter for the session, so Hypothesis's final replay of a
  failing example makes no new model call and can't turn flaky.
- PIPELINE_PROPERTY_DELAY_S (default 20) pauses between conversions to stay
  under per-minute provider limits.

Logging (R7.4): failure messages hold status, attempts, rule IDs and line IDs
only. Model output lines are never printed.
"""

import json
import os
import time
from typing import Any

import httpx
import pytest
from hypothesis import Phase, given, settings
from strategies import synthetic_letters

from checks import analyse, check_easy_read
from checks.models import Line

pytestmark = pytest.mark.needs_model

WEB_URL = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
EXAMPLES = int(os.environ.get("PIPELINE_PROPERTY_EXAMPLES", "5"))
DELAY_S = float(os.environ.get("PIPELINE_PROPERTY_DELAY_S", "20"))
TIMEOUT_S = 300.0

P1_TO_P8 = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]
JUDGED = {"P9", "P10"}
# Errors that say nothing about the pipeline's output.
INFRA_ERRORS = {"rate_limited", "daily_limit", "providers_unavailable", "checker_unavailable"}


class ProviderUnavailable(Exception):
    """The web app, checker or model providers couldn't serve the conversion."""


# Letter text -> outcome, for this session only. Kept in memory, never written.
_outcomes: dict[str, dict[str, Any] | Exception] = {}
_last_call = 0.0
_infra_failure: ProviderUnavailable | None = None


def _post_convert(original: str) -> dict[str, Any]:
    """POST the letter and return the stream's `result` event payload."""
    try:
        with httpx.stream(
            "POST", f"{WEB_URL}/api/convert", json={"original": original}, timeout=TIMEOUT_S
        ) as response:
            if response.status_code != 200:
                response.read()
                code = _error_code(response)
                message = f"/api/convert returned {response.status_code} ({code})"
                if response.status_code in (429, 503) or code in INFRA_ERRORS:
                    raise ProviderUnavailable(message)
                raise AssertionError(message)
            for raw in response.iter_lines():
                if not raw.strip():
                    continue
                event = json.loads(raw)
                if event.get("type") == "result":
                    return event["result"]
                if event.get("type") == "error":
                    code = event.get("error")
                    message = f"pipeline error event: {code} (status {event.get('status')})"
                    if code in INFRA_ERRORS:
                        raise ProviderUnavailable(message)
                    raise AssertionError(message)
    except httpx.TransportError as err:
        raise ProviderUnavailable(
            f"web app not reachable at {WEB_URL} ({type(err).__name__}). Start the checker "
            "and `npm run dev` in web/, or set WEB_URL."
        ) from None
    raise AssertionError("/api/convert stream ended without a result event")


def _error_code(response: httpx.Response) -> str:
    try:
        return str(response.json().get("error"))
    except ValueError:
        return "unknown"


def convert(original: str) -> dict[str, Any]:
    """Convert once per letter per session, spacing calls out by DELAY_S."""
    global _last_call, _infra_failure
    if original in _outcomes:
        cached = _outcomes[original]
        if isinstance(cached, Exception):
            raise cached
        return cached
    if _infra_failure is not None:
        # Providers are already failing: stop spending quota on this run.
        raise _infra_failure
    wait = _last_call + DELAY_S - time.monotonic()
    if _last_call and wait > 0:
        time.sleep(wait)
    outcome: dict[str, Any] | Exception
    try:
        outcome = _post_convert(original)
    except ProviderUnavailable as err:
        _infra_failure = err
        outcome = err
    except AssertionError as err:
        outcome = err
    finally:
        _last_call = time.monotonic()
    _outcomes[original] = outcome
    if isinstance(outcome, Exception):
        raise outcome
    return outcome


def _summary(result: dict[str, Any]) -> str:
    return f"status={result['status']} attempts={result['attempts']}"


@settings(
    max_examples=EXAMPLES,
    deadline=None,
    # No shrink (see the module docstring), and no example database: replaying
    # saved letters would spend quota on letters this run didn't choose.
    phases=(Phase.explicit, Phase.generate),
    database=None,
)
@given(synthetic_letters())
def test_pipeline_output_satisfies_p1_to_p8(original: str) -> None:
    """For every generated letter, the pipeline's output SHALL satisfy P1 to P8.

    **Validates: Requirements, Correctness Properties P1 to P8; Property-based
    testing items 1 and 2**
    """
    result = convert(original)

    if result["status"] == "blocked":
        failed = [c["rule"] for c in result["checks"] if not c["passed"]]
        pytest.fail(f"pipeline blocked the output ({_summary(result)}, failed rules {failed})")

    lines = [Line.model_validate(line) for line in result["lines"]]
    if not lines:
        pytest.fail(f"pipeline returned no lines ({_summary(result)})")

    reported = {c["rule"]: c for c in result["checks"]}
    flagged = sorted(rule for rule, c in reported.items() if not c["passed"])
    if result["status"] == "flagged" and not set(flagged) <= JUDGED:
        pytest.fail(f"pipeline flagged {flagged} ({_summary(result)})")

    # Independent recheck: key facts from the Original, never from the output.
    key_facts = analyse(original).key_facts
    rechecked = check_easy_read(original, key_facts, lines)
    failures = {r.rule: r.line_ids for r in rechecked if not r.passed}
    reported_failures = {rule: reported[rule]["line_ids"] for rule in P1_TO_P8 if not reported[rule]["passed"]}
    if failures or reported_failures:
        pytest.fail(
            f"output fails P1 to P8 ({_summary(result)}): recheck {failures}, "
            f"pipeline report {reported_failures}"
        )
