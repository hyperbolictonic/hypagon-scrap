# 03 — Parser: lxml Parity

[← Index](index.md)

Reproducing `lxml.html` behaviour in Node. This is the open question that decides how faithful
the port can be.

---

## Why this is hard

**`lxml.html` is not an HTML5-spec parser.** It is libxml2's legacy, lenient HTML parser
(`htmlReadMemory` in C).

`parse5` / `jsdom` implement WHATWG HTML5. So **the spec-compliant parsers are the *less*
compatible choice** — they diverge from lxml on exactly the malformed markup that real pages are
full of. "Correct" and "compatible" point in opposite directions here.

Scrapling's parser needs: libxml2 HTML repair behaviour, XPath 1.0, `cssselect`-style CSS→XPath
translation, plus the Cython-layer conveniences (`get_all_text` with visibility rules,
`prettify`, `find_by_text`, `find_by_regex`).

---

## Probe results

### `libxml2-wasm` 0.7.2 — XML only

```
exports : XmlXPath, XmlDocument, XmlElement, XmlNode, XmlText,
          DtdValidator, RelaxNGValidator, XsdValidator, XmlC14NMode, ...
htmlRefs: []      ← no HTML parser
```

Full XPath 1.0, but **no `htmlReadMemory`**. Does not drop in. Usable as the base for a custom
emscripten build that enables libxml2's standard HTML module.

---

## Options matrix

| Option | libxml2 HTML? | XPath | Native build | Parity | Risk |
|---|---|---|---|---|---|
| **`libxmljs2` 0.37.0** | ✅ `parseHtml`, `parseHtmlString`, `parseHtmlFragment` | ✅ 1.0 | NAN + `prebuild-install` | **93%** — pinned to libxml2 2.9.9 | Node ABI; needs a prebuild or MSVC |
| **Custom libxml2 → WASM (HTML enabled)** | ✅ built and verified | ✅ 1.0 | emscripten, build-time | **100% on S1b corpus** | Build + maintenance; heap/copy overhead; no CSS yet |
| libxml2 via FFI (`koffi` + `libxml2.dll`) | ✅ | ✅ | no binding build; ship the DLL | Highest | Large manual FFI surface, memory safety |
| `parse5` 8.1 + `xpath` 0.0.36 | ❌ HTML5 spec | ✅ | none | Approximation | Diverges on forgiving repair |
| `htmlparser2` 12 / `cheerio` 1.2 + `xpath` | ❌ forgiving but different | ✅ | none | Approximation | Same, different flavour |
| `linkedom` + `xpath` | ❌ | partial | none | Low | Least complete |
| Python `lxml` sidecar | ✅ | ✅ | none | **Perfect** | Adds a Python dependency |

Only the first three are actually libxml2. Everything else approximates it.

### `libxmljs2` — verified API surface

From its `index.d.ts`:

```
functions: parseXml, parseXmlString, parseHtml, parseHtmlString, parseHtmlFragment,
           memoryUsage, nodeCount
classes  : Document, Node, Element, Text, Comment, ProcessingInstruction,
           Namespace, SaxParser, SaxPushParser
```

- `engines: node >=22`
- Dependencies: `bindings`, **`nan`**, `node-gyp`, `prebuild-install`
- **No CSS selector support** → a `cssselect`-equivalent CSS→XPath layer is required regardless
  of parser choice

---

## The ABI risk

`libxmljs2` uses **NAN**, not N-API. NAN modules are tied to the V8/Node ABI, so each Node major
needs its own prebuild — or a local compile.

This machine currently has **no MSVC / VS Build Tools**, so:

- If a prebuild exists for the target ABI → fine
- If not → the spike fails on this machine until build tools are installed

This is a real deployment consideration, not just a spike annoyance: shipping `libxmljs2` means
tracking Node releases or shipping your own prebuilds. N-API-based alternatives (custom WASM,
FFI) do not have this problem.

---

## Acceptance criteria for the spike

Parse a corpus of deliberately nasty HTML with both `lxml.html` and the Node candidate, then
compare:

1. **Tree shape** — tag names, nesting order, implied/auto-closed elements
2. **Attributes** — names and values, including case handling
3. **Text content** — concatenation and whitespace behaviour
4. **XPath** — identical results for a set of representative queries (absolute, indexed,
   attribute predicates, text())
5. **Entity handling** — `&amp;`, `&#39;`, `&nbsp;`, invalid entities

Corpus must include: unclosed tags, overlapping tags, stray `</div>`, nested tables, `<p>` with
block children, attributes without quotes, uppercase tags, duplicate attributes, UTF-8 and
CJK content, `<script>`/`<style>` containing markup-like text, and a `<template>`.

**PASS:** tree + XPath identical on the corpus.
**PARTIAL:** differences confined to documented edge cases → acceptable with a divergence list.
**FAIL:** structural differences on ordinary malformed markup → use a WASM libxml2 build.

---

## Spike S1 result (2026-11-13)

Measured against `lxml` 6.1.3 / libxml2 2.11.9: **14/15 corpus cases identical (93%)**. The one
failure is `<script>` content containing markup-like text — caused by **`libxmljs2` pinning
libxml2 2.9.9 (2019)**, not by an API limitation.

`libxmljs2` compiles libxml2 from `vendor/libxml/` (see `HTMLparser.c` in its `binding.gyp`), so
the engine is frozen at whatever it vendored. See [05-spikes.md](05-spikes.md#s1--parser-parity)
for the full result.

**Consequence for the matrix:** `libxmljs2` *as shipped* is a 93% solution, and latent divergence
grows with every upstream fix it misses. Parity requires supplying a modern libxml2 yourself —
fork-and-revendor, custom WASM, or FFI. All three are "you own a build", so the decision is about
*which* build, not whether.

Also environmental, worth recording:

- No prebuild for Node 26 → build fails; works on Node 24.22.3
- npm 12 blocks native install scripts by default (`npm install-scripts approve libxmljs2`)

---

## Spike S1b result (2026-11-13) — gap closed

Built libxml2 **2.11.9** to WASM with emscripten 7.0.0 and the HTML parser enabled, then re-ran the
**unchanged** corpus and harness: **15/15 identical to `lxml` 6.1.3 (100%)**.

This confirms S1's diagnosis. Same tree, same attributes, same text, same XPath — including the
`<script>` case that `libxmljs2` truncated. Artifacts are **466 KB `.wasm` + 59 KB glue**, with no
per-Node-ABI prebuild problem.

**Verdict: the WASM route is validated and should be the default parser.** It was the cheapest of
the three remediation routes in practice — no MSVC, no fork to maintain, no FFI surface, and the
consumer needs no toolchain at all because the artifact is prebuilt.

Remaining work is engineering, not research:

- a CSS→XPath layer (libxml2 has none; `libxmljs2` doesn't either — always required)
- the `get_all_text` / `prettify` / `find_by_text` / `find_by_regex` conveniences
- an encoding policy for raw bytes vs. the `str` path (see [05](05-spikes.md#s1b--parser-parity-via-self-built-wasm))
- a memory model for long-lived trees instead of the single-document handle used in the spike

See [05-spikes.md](05-spikes.md#s1b--parser-parity-via-self-built-wasm) for build friction and the
two adapter bugs (interned names must not be freed; walk from `<html>`, not the document node).

---

## Open questions

- [x] Does libxml2 HTML repair actually match `lxml.html` on the corpus? → **yes, 15/15 with 2.11.9**
- [ ] How much must the corpus grow before parity is considered settled?
- [ ] Encoding policy for raw bytes: honour `Content-Type` / `<meta charset>`, or always UTF-8?
- [ ] Does `hx_path` (via `xmlGetNodePath`) produce exactly the strings relocation scores against?
- [ ] WASM performance vs. `lxml` — not measured yet; matters for large crawls
- [ ] Is the maintenance burden of tracking NAN prebuilds acceptable long-term? (moot if WASM ships)
