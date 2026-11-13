from checks.models import CheckResult, Rule


def line_result(rule: Rule, failing: list[str], details: list[str]) -> CheckResult:
    """Result for a rule that fails whole lines and has no key facts."""
    return CheckResult(
        rule=rule,
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
