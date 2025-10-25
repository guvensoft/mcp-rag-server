import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from semantic_engine import SemanticEngine


def test_search_returns_result_for_matching_text():
  with TemporaryDirectory() as tmp:
    entries = [
        {
            "id": "calc:add",
            "file": "calc.ts",
            "symbol": "add",
            "startLine": 1,
            "endLine": 5,
            "text": "export function add(a: number, b: number) { return a + b; }",
        },
        {
            "id": "calc:sub",
            "file": "calc.ts",
            "symbol": "sub",
            "startLine": 6,
            "endLine": 10,
            "text": "export function sub(a: number, b: number) { return a - b; }",
        },
    ]
    data_path = Path(tmp) / "semantic_entries.json"
    data_path.write_text(json.dumps(entries), encoding="utf-8")

    engine = SemanticEngine(tmp)
    results = engine.search("add numbers", top_k=3)

    assert results, "Expected at least one result"
    assert results[0]["file"] == "calc.ts"
