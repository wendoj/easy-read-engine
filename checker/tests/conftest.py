import pytest


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    # Treat "no tests collected" (exit 5) as success while the suite is still empty.
    if exitstatus == pytest.ExitCode.NO_TESTS_COLLECTED:
        session.exitstatus = pytest.ExitCode.OK
