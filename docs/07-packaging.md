# 07 — Packaging & Distribution

[← Index](index.md)

S1b produced a working **HTML-capable libxml2 in WASM** with 100% parity against `lxml`. Nothing
equivalent exists on npm. That is a distribution opportunity, and it is also the enabling dependency
for a faithful Node port.

---

## The gap

Surveyed 2026-11-13. XPath/XML/schema validation in WASM is well served; **the HTML parser
specifically is not**.

| Package / repo | Stars | HTML parser exposed? | Notes |
|---|---|---|---|
| `libxml2-wasm` 0.7.2 (`jameslan/libxml2-wasm`) | 55 | ❌ | Exports `XmlDocument`, `XmlXPath`, `DtdValidator`, `RelaxNGValidator`, `XsdValidator`. `htmlRefs: []` |
| `matiasinsaurralde/wasm-libxml2` | 11 | ❌ | Compiles `HTMLparser.o`, but the public API is `xmlParseMemory` — HTML is linked, never surfaced |
| `libxmlwasm/libxml.wasm` | 0 | ❌ | Readme uses `<html>` only as sample markup |
| `@ai-ecoverse/wasm-libxml2` 2.15.4-3 | — | ❌ | Self-described XML parser; no HTML in its surface |
| `libxmljs2` 0.37.0 | — | ✅ | Native addon, **not** WASM; pinned libxml2 2.9.9; NAN/ABI-bound |

The most popular option uses HTML as its own documentation filename. The second actually builds the
HTML module and then declines to expose it. So the gap is real, but narrow and specific: not
"libxml2 in WASM" (solved, repeatedly) but **"libxml2's HTML parser in WASM, with an XPath surface"**.

### Why the gap exists

- HTML is a separate module (`HTMLparser.c`, `HTMLtree.c`) that wrappers disable to shrink the binary
  and because their audience is XML/XSD validation.
- HTML repair semantics are the opposite of what XML users want — lenient, auto-closing,
  case-insensitive. Exposing both invites confusion.
- Anyone wanting HTML in JS was pushed toward HTML5 parsers (`parse5`, `htmlparser2`), which are
  *less* compatible with `lxml` — see [03](03-parser-lxml.md).

---

## Why publish

| Reason | Detail |
|---|---|
| License permits it | libxml2 is **MIT** — redistributable with notice, no copyleft obligations |
| Consumers need no toolchain | A committed `.wasm` removes MSVC, node-gyp, NAN/ABI prebuilds, and the npm 12 install-script gate |
| The hard part is done | Parity is measured, not assumed (S1b) |
| It is the port's foundation | Hypagon needs it; the next person porting a `lxml`-based tool needs it too |
| Sandboxing is a feature | Parsing hostile HTML inside WASM is safer than a native addon with a raw pointer surface |

The artifact is small: **466 KB `.wasm` + 59 KB glue**.

---

## What the package should be

```
libxml2-html-wasm/
  dist/hx.wasm          # libxml2 2.11.9, HTML + XPath enabled
  dist/hx.mjs           # emscripten glue, MODULARIZE
  dist/index.d.ts
  README.md             # memory contract + parity statement
  LICENSE               # MIT, libxml2 notice
```

Proposed API shape (already prototyped in `spikes/libxml2-wasm/src/hx_wrapper.c`):

- `parse(html, { encoding })` → `Document`
- tree walk: `type`, `name`, `text`, `children`, `attrs`
- `path(node)` → XPath string matching lxml's `getpath()`
- `xpath(doc, expr)` → nodeset / number / string
- explicit `free()`

CSS selectors should **not** be in this package. libxml2 has none, `libxmljs2` has none, and
`cssselect` semantics deserve a separate, testable layer.

---

## Decisions to settle before publishing

1. **Memory model.** The spike's single `last_doc` handle will not survive concurrent parsing.
   Options: explicit `free()`, arena-per-document, or `FinalizationRegistry` for safety with an
   escape hatch. Leaks here are silent and unbounded.
2. **Encoding policy.** `lxml` parity requires UTF-8 for the `str` path, but raw responses carry
   `Content-Type` or `<meta charset>`. Ship both modes and document the difference.
3. **Sync vs async init.** Synchronous instantiation is fine in Node; browsers want `await`.
4. **Environment target.** Currently `-sENVIRONMENT=node`. Browser support is cheap to add but
   changes the glue.
5. **Versioning.** Mirror upstream: `2.11.9-1`, so "which lxml does this match?" is answerable from
   the version string.
6. **Scope creep.** HTML + XPath only. XML/XSD come nearly free from the same binary but double the
   test surface.

---

## Distribution mechanics

- **npm**, with the built `.wasm` committed or attached — not built on install. Building on install
  would reintroduce the exact toolchain problem the package solves.
- **CI** builds with emsdk on a tag, caching the toolchain (~2.1 GB).
- **Parity gate**: run the corpus against `lxml` in CI. Python in the *build* repo is fine; consumers
  never touch it.
- **Rebuild cadence**: libxml2 is a high-value CVE target. A documented policy ("rebuild within N
  days of an upstream security release") matters more than the code.

---

## Risks and costs

| Risk | Severity | Mitigation |
|---|---|---|
| You own a C build indefinitely | Medium | Narrow surface (HTML + XPath), scripted build, CI |
| libxml2 CVEs | **High** | Automated upstream watch + rebuild policy |
| WASM performance vs native | Unknown | Benchmark before promising speed |
| Niche gets taken | Low–medium | Publishing early is the cheap claim |
| Artifact size in a browser bundle | Low | 466 KB; optional compression |

## Recommendation

Publish. It is the smallest artifact that unblocks the port, the licensing is unambiguous, and the
maintenance burden is bounded by libxml2's own release cycle rather than by Node ABI churn — which is
precisely the failure mode that makes `libxmljs2` a 93% solution.

---

## Open questions

- [ ] Explicit `free()` vs `FinalizationRegistry` — which is defensible for a public API?
- [ ] Is a browser target in scope, or Node-only for v1?
- [ ] What corpus size makes the parity claim publishable rather than a smoke test?
- [ ] WASM parse throughput vs `lxml` on a large corpus
- [ ] Ship XML/XPath too, or hold the surface to HTML only?
