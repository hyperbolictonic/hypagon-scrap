# 04 — Adaptive Relocation

[← Index](index.md)

Scrapling's actual differentiator. Read from `scrapling/parser.py`.

---

## What it does

When a site's markup changes, relocate previously-matched elements instead of failing. Ordinary
selector libraries return nothing; this estimates the best candidate and can return several.

There are **two distinct algorithms**, and they work differently.

---

## Algorithm 1 — `relocate(element, percentage=40, selector_type=False)`

1. `element` is a fingerprint **dict** (from `_StorageTools.element_to_dict`)
2. Scan **every element in the document** (`_find_all_elements`)
3. Score each candidate
4. Bucket results by score, take the highest
5. Return **all** elements tied at that score
6. Reject if the best score is below `percentage` (default 40)

Complexity: **O(N) full-document scan per relocation**, scoring every node.

### The scoring function

`__calculate_similarity_score(original, candidate)` accumulates `score` and `checks`, then
returns the mean — i.e. a percentage.

| Feature | Comparison |
|---|---|
| `tag` | exact equality (+1) |
| `text` | `SequenceMatcher.ratio()` |
| `attributes` | dict diff (`__calculate_dict_diff`) |
| `class`, `id`, `href`, `src` | `SequenceMatcher.ratio()` each — only if present on the original |
| `path` | `SequenceMatcher.ratio()` on the **root-to-element tag tuple**, e.g. `('html','body','div','p')` |
| `parent_name` | `SequenceMatcher.ratio()` |
| `parent_attribs` | dict diff |
| `parent_text` | `SequenceMatcher.ratio()` |
| `siblings` | `SequenceMatcher.ratio()` on the tuple of sibling tag names — only when present |

Notes:

- A candidate with no attributes at all still scores on that axis — absence is not penalised
- Parent features only count when the original has a parent name
- `path` carries real weight, which creates the coupling below

---

## Algorithm 2 — `find_similar(similarity_threshold=0.2, ignore_attributes=("href","src"), match_text=False)`

Different strategy: generate candidates structurally, then filter.

1. Candidates must share **depth**, **tag**, **parent tag**, and **grandparent tag**
2. Then compare attributes; accept above `similarity_threshold`
3. `href`/`src` ignored by default (URLs differ between sibling items)
4. If neither element has attributes → 100% match

Inspired by AutoScraper. Cheap, because the candidate set is structural rather than a full scan.

---

## The coupling that matters

The score compares `original["path"]` to `data["path"]`, and those are **root-to-element tag
tuples** built from the parse tree — *not* XPath strings (an earlier note in this project said
"path string"; that was wrong, and it matters because it changes what parity means).

```
('html', 'body', 'div', 'section', 'article')
```

The coupling is therefore through **tree shape**, not path formatting: implied elements, auto-closed
tags and repair behaviour all shift the tuple, which shifts every relocation score. Two parsers that
agree on `getpath()` but disagree on an implied `<tbody>` will still produce different scores.

**Parser choice and relocation parity are not independent decisions.** Both must be validated
against the same corpus. See [03](03-parser-lxml.md).

---

## Options

| # | Option | Parity | Cost | Notes |
|---|---|---|---|---|
| 1 | **Faithful port** of both algorithms (TypeScript) | Exact | Medium | Needs `SequenceMatcher` (~300 lines) + `element_to_dict` + storage |
| 2 | Indexed candidates on top of #1 | Exact | Low | Removes the O(N) scan; same results |
| 3 | **Embedding scorer** (cosine on text) | Different | Medium–high | Robust to full redesigns; non-deterministic; needs a model |
| 4 | Multi-selector fallback chain | Coarse | Low | Cheap, far weaker than relocation |
| 5 | DOM snapshot diffing between versions | High | High | Needs whole-DOM storage |
| 6 | Off-the-shelf self-healing (`healwright`) | n/a | — | LLM-based Playwright locators; wrong shape for a library |

**Hypagon note:** its bundle already contains `onnxruntime-node`, so option 3 adds no new runtime
dependency there — only a model.

---

## Recommended design

Port option **1** as the deterministic core, add **2** as an internal optimisation, expose **3**
behind a pluggable scorer.

```ts
interface Fingerprint {
  tag: string;
  text: string;
  attributes: Record<string, string>;
  path: string;
  parentName?: string;
  parentAttribs?: Record<string, string>;
  parentText?: string;
}

interface Scorer {
  /** 0..100, matching __calculate_similarity_score semantics */
  score(fingerprint: Fingerprint, candidate: Node): number;
}

class Relocator {
  relocate(root: Document, fp: Fingerprint, threshold?: number): Node[];
  findSimilar(el: Element, opts?: { threshold?: number; matchText?: boolean }): Element[];
}
```

Default scorer = the ported formula, so results are reproducible. Consumers that want semantic
matching opt into an `EmbeddingScorer`.

### Porting sequence (all completed in S5)

1. `SequenceMatcher` equivalent (port from Python's `difflib`, ~300 lines; do **not** substitute a
   generic fuzzy-match library — the ratio semantics must match exactly)
2. `element_to_dict` fingerprint builder
3. `__calculate_dict_diff`
4. `relocate` + `find_similar`
5. Validate against the Python reference

---

## Spike S5 result (2026-11-13) — PASS, 53/53

Both algorithms were ported and compared against Scrapling **0.5.1** running on the same corpus,
using the WASM parser on the JS side. The comparison covers the **full per-candidate score table**
and the fingerprint dict, not just the winning element — a port can pick the right element while
scoring everything slightly wrong.

| Corpus | Cases | Result |
|---|---|---|
| Curated (rename, insert sibling, wrap, id change, text change, table, list, whitespace) | 9 | ✅ 9/9 |
| Seeded fuzz (random trees + mutations) | 40 | ✅ 40/40 |
| Long / autojunk (≥200-char text, ≥200-char attr, 220 siblings, CJK) | 4 | ✅ 4/4 |

### The four things that actually decide parity

1. **`difflib` autojunk.** Sequences ≥200 long drop elements that appear more than `n/100 + 1`
   times. Any generic fuzzy matcher disagrees here.
2. **`round(x, 2)` is banker's rounding in Python**, not `Math.round`. Scores are bucketed by the
   rounded value, so a tie-breaking difference changes which elements share the winning bucket.
3. **`path` is a tag tuple**, so the coupling to the parser is via tree shape (implied `<tbody>`,
   auto-closed tags), not `getpath()`.
4. **`element.text` is own text, not deep text.** Using deep text makes every container look
   identical to every other container.

`find_similar` is a different animal: structural candidates first (same depth, tag, parent tag,
grandparent tag), then attribute ratios with `checks += max(len(orig), len(cand))`, so extra
attributes are penalised.

**Caveat:** the corpus is synthetic. It covers structural mutation and the autojunk boundary, but
not real-world markup diversity. Re-run against captured pages before calling it settled.

---

## Validation plan (executed, and what remains)

- [x] Reuse Scrapling's own relocation scenarios (curated corpus above)
- [x] Property: unchanged document → `relocate` returns the original element at 100%
- [x] Mutations: rename class, insert sibling, wrap in a div, change id/text
- [x] Deterministic fuzz across 40 random trees
- [x] Boundary cases for `SequenceMatcher` autojunk and CJK code points
- [ ] Re-run against real captured pages
- [ ] Compare the `EmbeddingScorer` path (deliberately different results — must be opt-in)
