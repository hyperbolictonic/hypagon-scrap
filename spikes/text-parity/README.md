# Spike — text helper parity

Do the ported text helpers produce exactly what Scrapling 0.5.1 produces?

**Yes — 33/33 operations across 2 documents.** Text output is compared as
strings, so this is a strict check rather than a structural one.

## Reproduce

```powershell
Set-Location spikes\text-parity
..\relocation\.venv\Scripts\python.exe py-ref.py text-golden.json
node run.mjs text-golden.json
```

## What is covered

| Helper | Variants |
|---|---|
| `get_all_text` | default, `strip`, custom separator, `ignore_tags=[]`, `valid_values=False`, scoped element, called on `<script>` |
| `find_by_text` | exact, cleaned query mismatch, `partial`, case-sensitive, `first_match`, scoped, tail-text negative case |
| `find_by_regex` | numeric pattern, whitespace pattern, case-sensitive, `clean_match=False` |

## Findings worth keeping

1. **`.text` is own text, not deep text.** Scrapling's property is
   `self._root.text`, which is lxml's own-text field. `get_all_text()` is the
   deep walk. This is easy to get wrong because every other scraping library
   treats `.text` as subtree content.
2. **`clean_match` cleans the element, not the query.**
   `find_by_text("Widget  100")` returns nothing even with `clean_match=True`,
   because the element text becomes `"Widget 100"` while the query keeps its
   double space. Preserved deliberately.
3. **`find_by_text` only considers elements with their own text.** The candidate
   XPath is `.//*[normalize-space(text())]`, so a text node in a tail position
   never makes its container a match.
4. **`get_all_text` on an ignored element returns `""`**, not its contents —
   the ignore set includes the element itself.
