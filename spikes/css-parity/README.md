# Spike — CSS→XPath parity

Does a hand-written CSS→XPath translator select the same nodes as Scrapling's
`cssselect` 1.6.0 path?

**Yes — 250/250 (50 selectors × 5 documents).**

Comparison is by **selected nodes**, not by XPath string: a different but
equivalent expression is acceptable; a different node set is not. The golden file
records cssselect's XPath too, purely for diagnosis.

## Reproduce

```powershell
# uses the venv from spikes/relocation (Scrapling 0.5.1 + cssselect 1.6.0)
Set-Location spikes\css-parity
..\relocation\.venv\Scripts\python.exe py-ref.py css-golden.json
node run.mjs css-golden.json
```

`run.mjs` prints `{ checked, failed, passRate }` and up to 15 diffs with the
cssselect XPath, expected paths and actual paths.

## Why not compare XPath strings

Scrapling builds `descendant-or-self::…` with `cssselect`'s `XPathExpr` join
machinery; this port emits simpler but equivalent axes (`/descendant::`,
`/following-sibling::*[1]/self::…`). Requiring string equality would reject
correct translations and encourage copying implementation details instead of
matching behaviour.

## Coverage

Documents: catalog (classes/ids/attrs), list (nth-child), table (nth-of-type),
form (checked/checked state), nested (only-child/of-type/empty).

Selectors cover: type/universal, class, id, all attribute operators including
`|=` and `!=`, combinators (` `, `>`, `+`, `~`), groups, `:not()`, `:root`,
`:empty`, `:first/last/only-child`, `:first/last/only-of-type`, the four
`:nth-*` forms, `:checked`, `:link`, `:contains()`, and `::text` / `::attr()`.

## Known semantic edge cases

- `:empty` uses `not(*) and not(string-length())`, matching cssselect. Note this
  is cssselect's definition, not a whitespace-sensitive CSS4 reading.
- `:checked` follows cssselect's HTML formula (selected `<option>`, checked
  checkbox/radio input).
- `:disabled` / `:enabled` are **not ported** — cssselect's implementations are
  long and depend on disabled-fieldset ancestry. The port throws rather than
  guessing.
- Escaped identifiers and namespace prefixes are rejected.

## Behaviour worth knowing

`page.css()` evaluates from the **root element**, matching Scrapling's
`self._root.xpath(...)`, not from the document node. The two differ for
`:scope`-style expressions and for `descendant-or-self` edge cases.
