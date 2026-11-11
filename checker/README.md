# Checker service

Deterministic Easy Read checks (sentence splitting, key facts, P1 to P8, symbol index), exposed over HTTP (FastAPI) and MCP.

```sh
uv sync
uv run pytest
uv run uvicorn http_app:app --app-dir src   # HTTP service on port 8000
uv run python src/mcp_server.py              # MCP server over stdio
```

MCP tools: `check_easy_read`, `extract_key_facts`, `find_symbol`. Each calls the same function as the matching HTTP route, with the same input limits. Kiro starts the server from `.kiro/settings/mcp.json`.

Routes: `POST /analyse`, `POST /key-facts`, `POST /check`, `GET /symbols?q=`, `GET /health`.

After changing a request or response model, regenerate the web app's types with `npm run gen:checker-types` in `web/`.
