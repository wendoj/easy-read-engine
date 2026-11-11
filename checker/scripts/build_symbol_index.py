"""Build the ARASAAC pictogram index at checker/data/symbols.json (task 10).

Fetches the English catalogue once from the ARASAAC API, leaves out
pictograms flagged `violence` or `sex`, and writes only the fields the design
needs (design "Symbols"):

    { id, keywords[], plurals[], lemmas[], categories[], tags[], set, licence }

IDs are strings, because `Line.symbol_id` is `str | None`. `lemmas` are the
spaCy lemmas (pinned model, see config.SPACY_MODEL) of the words in the
keywords and plurals, lower case, with punctuation and stop words removed
(stop words are kept when a keyword has nothing else). `find_symbol` ranks by
lemma overlap with these.

The catalogue is held in memory only. The script writes nothing but the
processed index. The index is committed, so the app never calls the ARASAAC
API at runtime. Pictograms are CC BY-NC-SA; see data/LICENSE-pictograms.md.

    cd checker && uv run python scripts/build_symbol_index.py
"""
import json
import sys
import urllib.request
from pathlib import Path

from checks.sentences import get_nlp

CATALOGUE_URL = "https://api.arasaac.org/v1/pictograms/all/en"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "symbols.json"
SET_NAME = "arasaac"
LICENCE = "CC BY-NC-SA"
EXCLUDED_FLAGS = ("violence", "sex")


def fetch_catalogue() -> list[dict]:
    request = urllib.request.Request(CATALOGUE_URL, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def _unique(items: list[str]) -> list[str]:
    """Keep the first copy of each non-empty item, in order."""
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _lemmas(phrases: list[str]) -> list[str]:
    lemmas: list[str] = []
    for doc in get_nlp().pipe(phrases, disable=["parser", "ner"]):
        words = [t for t in doc if not (t.is_punct or t.is_space)]
        content = [t for t in words if not t.is_stop] or words
        lemmas.extend(t.lemma_.lower() for t in content)
    return _unique(lemmas)


def build_entry(pictogram: dict) -> dict:
    keywords = _unique([k.get("keyword", "").strip() for k in pictogram.get("keywords", [])])
    plurals = _unique([k.get("plural", "").strip() for k in pictogram.get("keywords", [])])
    return {
        "id": str(pictogram["_id"]),
        "keywords": keywords,
        "plurals": plurals,
        "lemmas": _lemmas(keywords + plurals),
        "categories": _unique(pictogram.get("categories", [])),
        "tags": _unique(pictogram.get("tags", [])),
        "set": SET_NAME,
        "licence": LICENCE,
    }


def is_excluded(pictogram: dict) -> bool:
    return any(pictogram.get(flag) is True for flag in EXCLUDED_FLAGS)


def main() -> None:
    catalogue = fetch_catalogue()
    kept = sorted((p for p in catalogue if not is_excluded(p)), key=lambda p: int(p["_id"]))
    entries = [build_entry(p) for p in kept]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # One pictogram per line: compact, and diffs stay readable.
    body = ",\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in entries)
    OUTPUT.write_text(f"[\n{body}\n]\n", encoding="utf-8")

    excluded = len(catalogue) - len(kept)
    print(
        f"catalogue {len(catalogue)}, excluded {excluded} "
        f"(violence {sum(p.get('violence') is True for p in catalogue)}, "
        f"sex {sum(p.get('sex') is True for p in catalogue)}), "
        f"written {len(entries)} to {OUTPUT} ({OUTPUT.stat().st_size} bytes)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
