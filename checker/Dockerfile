# Checker service (FastAPI + spaCy). Build context: this directory.
#   docker build -t easy-read-checker checker
# The pinned en_core_web_sm 3.8.0 wheel is a locked dependency (pyproject
# [tool.uv.sources]), so `uv sync` installs it at build time and start-up
# downloads nothing.

FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first (cached unless pyproject.toml or uv.lock change).
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Project code and the symbol index. config.py finds data/symbols.json two
# levels above src/checks/, so the project is installed editable (uv's
# default) and runs from /app/src.
COPY README.md ./
COPY src ./src
COPY data ./data
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev \
 && /app/.venv/bin/python -c "import spacy; spacy.load('en_core_web_sm')"

# Non-root at run time. The code stays root-owned and read-only to this user;
# the service writes nothing to disk.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin checker
USER checker

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

# /health returns 200 once spaCy and the symbol index are loaded, 503 before.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

CMD ["uvicorn", "http_app:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000"]
