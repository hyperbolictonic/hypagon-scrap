# Spike S5 — Adaptive relocation port

Can Scrapling's two relocation algorithms be reproduced **exactly** in JavaScript? **Yes — 53/53
cases, comparing every candidate's score, not just the winner.**

| Corpus | Cases | Result |
|---|---|---|
| Curated (rename, sibling insert, wrap, id/text change, table, list, whitespace) | 9 | ✅ 9/9 |
| Seeded fuzz (random trees + mutations) | 40 | ✅ 40/40 |
| Long / autojunk (>200-char text, >200-char attr, 220 siblings, CJK) | 4 | ✅ 4/4 |

Reference is Scrapling **0.5.1**; the JS side runs on the WASM libxml2 parser, so this validates the
parser + relocation chain together — which is required, because scores depend on tree shape.

---

## Reproduce

```powershell
# reference environment
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install scrapling

# curated corpus
.\.venv\Scripts\python.exe py-ref.py out-python.json corpus.json
node js\run.mjs out-js.json corpus.json
node js\compare.mjs out-python.json out-js.json

# fuzz corpus
.\.venv\Scripts\python.exe gen_fuzz.py 40 corpus-fuzz.json
.\.venv\Scripts\python.exe py-ref.py out-python-fuzz.json corpus-fuzz.json
node js\run.mjs out-js-fuzz.json corpus-fuzz.json
node js\compare.mjs out-python-fuzz.json out-js-fuzz.json

# autojunk boundary
.\.venv\Scripts\python.exe gen_long.py
.\.venv\Scripts\python.exe py-ref.py out-python-long.json corpus-long.json
node js\run.mjs out-js-long.json corpus-long.json
node js\compare.mjs out-python-long.json out-js-long.json
```

`compare.mjs` diffs the fingerprint dict, the **entire score table**, the `relocate` result list and
both `find_similar` lists.

To validate a different build of the parser — for example the packaged multi-document artifact —
point the harness at it:

```powershell
$env:HX_MODULE = "..\..\packages\libxml2-html-wasm\build\hx.mjs"
node js\run.mjs out-js-pkg.json corpus.json
node js\compare.mjs out-python.json out-js-pkg.json
```

---

## What is ported

| Python | JS |
|---|---|
| `difflib.SequenceMatcher` | `js/difflib.mjs` (incl. autojunk, junk-extension passes, block merging) |
| `round(x, 2)` | `pyRound2` — banker's rounding on the exact binary value |
| `_StorageTools.element_to_dict` | `elementToDict` |
| `__calculate_dict_diff` | `dictDiff` |
| `__calculate_similarity_score` | `similarityScore` |
| `relocate` | `relocate` |
| `__are_alike` / `find_similar` | `areAlike` / `findSimilar` |

The tree is walked once into a flat registry instead of re-walking per candidate — an internal
optimisation that preserves document order and outputs.

---

## Gotchas (these decide parity)

1. **`path` is a tag tuple**, not an XPath string: `('html','body','div','p')`.
2. **Scrapling parses with non-default flags** — `remove_blank_text=True`, `remove_comments=True`,
   `huge_tree=True`, `encoding="utf-8"`, and it strips the input first. Note `remove_blank_text`
   is a **no-op for HTML `.text`** (libxml2 keeps whitespace); comments really are removed. The
   WASM wrapper mirrors the flags and drops comments.
3. **`difflib` autojunk** activates at ≥200 elements and removes "popular" values from the index.
4. **Python rounding is banker's rounding.** Scores are bucketed on the rounded value, so this is
   observable behaviour, not cosmetic.
5. **`element.text` is own text**, not deep text.
6. **The spike wrapper holds one static document.** Parsing a second document frees the first,
   leaving dangling pointers that return empty strings silently. Compute per-document results before
   parsing the next, or add real handles.

---

## Files

| File | Role |
|---|---|
| `js/difflib.mjs` | SequenceMatcher + `pyRound2` |
| `js/relocation.mjs` | registry, fingerprint, scoring, relocate, findSimilar |
| `js/run.mjs` | JS side of the harness |
| `js/compare.mjs` | diffs full score tables and result lists |
| `py-ref.py` | Scrapling reference (uses `_StorageTools` + private score method to expose the table) |
| `gen_fuzz.py` / `gen_long.py` | deterministic corpora |
| `scrapling-src/` | upstream checkout used to read the algorithms |

---

## Not covered

- Real captured pages (corpus is synthetic)
- `EmbeddingScorer` — deliberately different results, must stay opt-in
- Performance: the port scans every element per relocation; indexing is a later optimisation
