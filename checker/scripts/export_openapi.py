"""Write the HTTP adapter's OpenAPI schema to checker/openapi.json.

    uv run python scripts/export_openapi.py [output-path]

The web app generates `web/src/types/checker.ts` from this file
(`npm run gen:checker-types` in `web/`). Importing the app does not load spaCy;
that happens only at server start-up.
"""

import json
import sys
from pathlib import Path

CHECKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CHECKER_DIR / "src"))

from http_app import app  # noqa: E402


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else CHECKER_DIR / "openapi.json"
    out.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
