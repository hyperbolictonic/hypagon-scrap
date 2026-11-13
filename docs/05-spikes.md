# 05 — Spike Log

[← Index](index.md)

Pass/fail experiments. A spike exists to *falsify* something cheaply, so each one states what
would make it fail.

| ID | Spike | Question | Status | Result |
|---|---|---|---|---|
| S1 | Parser parity (`libxmljs2`) | Does `libxmljs2` match `lxml.html` on malformed markup? | ⚠️ partial — 93% | Version skew, not API |
| S1b | Parser parity (WASM) | Does a self-built libxml2 2.11.9 WASM close the gap? | ✅ pass — 100% | Modern engine fixes it |
| S2 | Transport fingerprint | Does a Node curl-impersonate wrapper match `curl_cffi`? | ✅ pass — 2 of 3 | Exact JA4 + Akamai match |
| S3 | Chromium cost | Is `patchright` fast/light enough for a default path? | ✅ pass | ~102 MB RSS, 166 ms cold, 160 ms nav |
| S4 | Electron `net` fingerprint | Does Electron `net` yield a Chromium-family fingerprint? | ✅ pass | Akamai identical to Chrome |
| S5 | Relocation algorithm | Reproduce `relocate` scoring exactly on fixtures | ✅ pass — 53/53 | Exact score tables |

---

## S1 — Parser parity

**Hypothesis:** `libxmljs2` (which links real libxml2) produces the same tree and XPath results
as `lxml.html` for malformed HTML.

**Method**
1. Python venv with `lxml` 6.1.3; Node with `libxmljs2` 0.37.0
2. Shared corpus of deliberately difficult HTML
3. Both sides emit normalised JSON: node tree (tag, attrs, text) + results of a fixed XPath set
4. Diff the two JSON documents

**Corpus**
unclosed tags · overlapping tags · stray closing tags · nested tables · block children inside
`<p>` · unquoted attributes · uppercase tags · duplicate attributes · UTF-8/CJK · `<script>` and
`<style>` containing markup-like text · `<template>` · invalid entities

**Pass criteria**
- PASS: tree and XPath identical on all cases
- PARTIAL: differences confined to documented edge cases (acceptable with a divergence list)
- FAIL: structural differences on ordinary malformed markup → switch to a WASM libxml2 build

**Known risk:** `libxmljs2` uses NAN, not N-API, so it needs a prebuild for the running Node ABI.
This machine has no MSVC build tools; a missing prebuild fails the spike for environmental
reasons, not algorithmic ones — retry on Node 24.22.3 before concluding anything.

**Result: ⚠️ PARTIAL — 14/15 cases identical (93%), and the single failure is version skew.**

| Item | Finding |
|---|---|
| Environment | `libxmljs2` 0.37.0 on Node **24.22.3**; `lxml` 6.1.3 / libxml2 2.11.9 |
| Node 26 | ❌ **no prebuild**; falls back to `node-gyp` and MSBuild fails (no C++ workload) |
| npm 12 | ⚠️ blocks native install scripts by default — needs `npm install-scripts approve` |
| Trees matched | unclosed tags, overlapping tags, stray closers, nested tables, `<p>` + block child, unquoted attrs, uppercase tags, duplicate attrs, entities, CJK, `<template>`, deep nesting |
| Divergence | `<script>` content containing markup-like text |

**Root cause — libxml2 version skew, not an API gap:**

```
libxmljs2  → libxml2 2.9.9   (2019, vendored in vendor/libxml/, compiled in)
lxml 6.1.3 → libxml2 2.11.9
```

`libxmljs2`'s `binding.gyp` compiles `vendor/libxml/HTMLparser.c` from its own copy, so the
engine version is whatever it vendored. On 2.9.9 the script CDATA handling truncates at the
first closing tag inside the script text:

```
input     <div><script>var x = '<div>not a real div</div>';</script>after</div>
libxmljs2 <script>var x = '<div>not a real div</script></div>';after    ← truncated
lxml      <script>var x = '&lt;div&gt;not a real div&lt;/div&gt;';</script>after
```

**Interpretation:** `libxmljs2` as shipped cannot deliver parity, because it is pinned to a
2019 engine. It also means every behaviour fixed upstream between 2.9.9 and 2.11.9 (or later)
is a latent divergence, not just this one case.

**Remediation:** supply a modern libxml2 yourself.

| Route | Work | Notes |
|---|---|---|
| Fork `libxmljs2`, replace `vendor/libxml/` with modern sources, rebuild | Medium–high | Own a native fork + prebuilds per Node ABI; needs MSVC |
| Custom libxml2 → WASM with HTML enabled | Medium | Same engine, portable, no per-ABI builds |
| FFI (`koffi`) against a modern `libxml2.dll` | Medium | No compile at install time; manual memory surface |


---

## S1b — Parser parity via self-built WASM

**Hypothesis:** the 7% divergence in S1 is engine version, not architecture. Build libxml2 **2.11.9**
(the exact version `lxml` 6.1.3 links) to WASM with the HTML parser enabled, and the same harness
should match completely.

**Method**
1. Emscripten 7.0.0 toolchain (`emsdk install latest`, 714 MiB download, ~2.1 GB on disk)
2. libxml2 2.11.9 release tarball from `download.gnome.org`
3. `src/hx_wrapper.c` — a thin C surface exposing parse, tree walk, attributes, paths, XPath
4. `.mjs` adapter that emits the *same* normalised JSON as `node-side.js` / `py-side.py`
5. Re-run the unchanged 15-case corpus diff against `lxml` 6.1.3

**Result: ✅ PASS — 15/15 cases identical (100%), including the `<script>` case that broke S1.**

| Item | Value |
|---|---|
| Engine | libxml2 **2.11.9** — same as `lxml` 6.1.3 |
| Artifacts | `hx.wasm` **466.6 KB** + `hx.mjs` **58.7 KB** |
| Translation units | 40 |
| Build time | ~2 min |
| Corpus | 15/15 — trees, attributes, text, and all 10 XPath expressions |

### Build friction (worth knowing before repeating this)

Autotools is the expected route and the wrong one on Windows. Three things had to be solved:

| Problem | Cause | Fix |
|---|---|---|
| `libxml/xmlversion.h` not found | generated by `configure` from `xmlversion.h.in`, not shipped | `gen-headers.js` substitutes the 40 `@VARS@` |
| `config.h` not found | `libxml2/libxml.h` includes it **unconditionally** | emit a minimal `config.h` with only true `HAVE_*` defines |
| duplicate symbol `main` | `nanoftp.c`, `runsuite.c`, `runxmlconf.c` are standalone drivers | exclude them from the source list |

`HAVE_*` must be defined only when true — libxml2 tests them with `#ifdef`, so `#define HAVE_MMAP 0`
would *enable* mmap.

### Two adapter bugs that are really port findings

Both cost a full debugging cycle and both will recur in the real implementation:

1. **Never free interned node names.** `node->name` and attribute names point into the document's
   string dictionary. Passing them to `xmlFree` corrupts the dictionary — the symptom is silent,
   not a crash: XPath then returns **zero results** for elements that demonstrably exist, and tag
   names come back as mojibake. Only `xmlNodeGetContent` / `xmlGetNodePath` results own memory.
2. **Walk from the root element, not the document node.** `lxml`'s `document_fromstring` returns
   the `<html>` element and callers iterate *its children*, so the first emitted node is `<body>`.
   Starting at the `xmlDoc` yields an extra `<html>` level and shifts every depth.

### One behavioural gap to design around

libxml2 defaults HTML **without a declared charset** to ISO-8859-1. `lxml` avoids this because it
receives a Python `str`, encodes it to UTF-8, and passes `encoding="UTF-8"` explicitly. The wrapper
therefore takes an encoding argument; passing `NULL` mojibakes CJK.

This is correct parity for the `str` path, but the port must decide what to do for **raw bytes**
with a `Content-Type` charset or `<meta charset>`: pass the declared encoding, or let libxml2 sniff.

**Caveat on strength of evidence:** 15 cases is a smoke test, not a proof. The strong argument is
structural — identical engine version — but the corpus should grow before this is called settled.

---

## S2 — Transport fingerprint parity

**Hypothesis:** a Node wrapper around `lexiforest/curl-impersonate` puts the same bytes on the wire
as Python `curl_cffi`, which binds the same project.

**Method:** fetch `https://tls.peet.ws/api/all`, which computes JA3/JA4/Akamai H2 **from the actual
handshake**, so it measures the wire rather than the library's claims. Python `curl_cffi` 0.17.0 is
the reference; three Node candidates were compared against it.

**Pass criterion corrected mid-spike.** The original "identical JA3/JA4" is unachievable: Chrome
sends GREASE (RFC 8701), random reserved values injected into the cipher/extension lists, so the
hashed bytes differ every connection. Measured on one candidate, 4 consecutive runs:

```
distinct: ja3=4   ja4=1   akamai=1
```

So the criterion is **JA4 + Akamai**. JA3 is only a sanity signal — and a Chrome client with a
*stable* JA3 would actually be the suspicious one. Safari doesn't GREASE, which is why its JA3
matched byte-for-byte.

**Result: ✅ PASS — two of three candidates reproduce `curl_cffi` exactly.**

| Candidate | Mechanism | chrome | chrome131 | safari | Latency (median) |
|---|---|---|---|---|---|
| `cuimp` 2.1.2 → lexiforest 2.3.2 | CLI subprocess | ✅ | ✅ | ✅ | 609 ms |
| `curl-cffi-node` 0.1.8 | napi, in-process | — | ✅ | not tested | 548 ms |
| `@webcrawl/curl-impersonate` 1.4.7 | CLI subprocess | ❌ | ❌ | ❌ | — |

Reference JA4 values: `chrome` → `t13d1517h2_8daaf6152771_cb7bf5808d99`, `chrome131` →
`t13d1516h2_8daaf6152771_02713d6af862`, `safari` → `t13d2013h2_a09f3c656075_7f0f34a4126d`.
Akamai matched on all passing cases.

Latency caveat: WAN RTT to the echo service (~500 ms) dominates both numbers, so the in-process
advantage is only ≈60 ms per request — not the order-of-magnitude difference the architectures
suggest.

### Why `@webcrawl` failed — a real portability gap

Not a network issue: `assetForPlatform('win32','x64')` returns **`null`**. The package ships only
`x86_64-macos`, `arm64-macos` and four Linux assets; on Windows it throws
`ImpersonateUnavailableError` on every call. It does pin SHA256 per asset, which is better supply
chain hygiene than `cuimp`.

### Operational gaps in the passing candidates

| Gap | Consequence |
|---|---|
| `curl-cffi-node` exposes no CA path (100 `CurlOpt` entries, none CA-related) | On Windows every request fails with curl error 60; only `verify:false` works — unacceptable for real scraping |
| `cuimp`'s "verify" only checks the binary is executable | Binary **and** CA bundle fetched from GitHub at runtime with **no hash check** |
| Subprocess model | No connection reuse; ≈60 ms spawn cost per request |

**Verdict: the fingerprint question is closed — do not compile TLS.** The remaining work is
supply-chain, not cryptography: vendor the pinned lexiforest binary (v2.3.2, MIT) and put a thin
wrapper around it. On Linux, `curl-cffi-node` is the better shape once CA handling is confirmed.

---

## S3 — Chromium cost

**Hypothesis:** Chromium is too heavy to be the default path, so it belongs behind an opt-in.

**Method:** `patchright` with one reused browser and a single context; navigate three times to
`tls.peet.ws/api/all`, then `example.com`. Measure cold launch, warm navigation and the working-set
delta across browser processes.

**Result: ✅ PASS — cheaper than assumed. Chromium is viable by default for JS-rendered targets.**

| Metric | Measured | Earlier assumption |
|---|---|---|
| Cold launch | **166 ms** | 200–500 ms |
| Warm navigation (echo endpoint) | **542 ms** median | 50–150 ms |
| `example.com` `domcontentloaded` | **160 ms** | — |
| RSS delta | **≈102 MB** (2885 → 2987 MB) | 100–400 MB |

Caveats: the RSS figure is a system-wide delta (`patchright` does not expose the browser PID) while
another Chrome was running, so treat it as an upper bound on the *added* cost, not a precise figure.
The 542 ms navigation is dominated by WAN round-trip to the echo service — `example.com` at 160 ms is
the more representative number.

**Fingerprint bonus:** the browser emitted `ja4 t13d1516h2_8daaf6152771_806a8c22fdea`, Akamai
`52d84b11…` — the same Akamai hash as real Chrome and `curl_cffi`.

**Implication:** the transport comparison in [02](02-transport-tls.md) was framed on a latency gap
that does not exist. Chromium's real cost is ~100 MB of RAM and a launch, not per-request time.

---

## S4 — Electron `net` fingerprint

**Hypothesis:** Electron's `net` module routes through Chromium's network service, so it should emit
a genuine Chromium-family fingerprint — letting an Electron host skip the vendored binary entirely.

**Method:** from an Electron **main** process, three `net.request` calls to `tls.peet.ws/api/all`;
compare JA4/Akamai against real Chrome and `curl_cffi`.

**Result: ✅ PASS — genuine Chromium fingerprint.**

| Item | Value |
|---|---|
| Electron / Chromium | 45.3.1 / **156.0.8078.96** |
| Akamai H2 | `52d84b11737d980aef856699f885ca86` — **identical to real Chrome** |
| JA4 | `t13d1517h2_8daaf6152771_a87ad97598a9` (runs 2–3), `t13d1516h2_…806a8c22fdea` (run 1) |
| Per request | 738–886 ms (WAN-dominated) |

JA4 shares Chrome's structure — `t13d1517h2`, the same cipher-list hash `8daaf6152771`, 15 ciphers —
and differs only in the extension hash and extension count. That is the *right* kind of difference:
Electron bundles Chromium 156, while `curl_cffi`'s `chrome` profile imitates a fixed older build.

**Two caveats worth keeping:**

1. **Not identical to `curl_cffi`'s profile** — so "drop-in replacement" is false in the strict sense.
   It is a real Chromium fingerprint, which is arguably stronger, but it will drift with Electron's
   Chromium version rather than staying pinned.
2. **JA4 varied between runs** (16 vs 17 extensions) on the first request. Likely warm-up state
   (ALPS/ECH), but it means a single sample is not enough to characterise an Electron build.

**Implication:** Hypagon needs no vendored binary. Electron `net` is the cheapest possible transport
for the primary consumer — no external process, no supply chain, no CA-bundle problem.

---

## S5 — Relocation algorithm

**Hypothesis:** both relocation algorithms can be reproduced exactly in JS, including the scoring
formula, so results are deterministic and comparable.

**Method:** port `difflib.SequenceMatcher` (including its autojunk heuristic), `element_to_dict`,
`__calculate_dict_diff`, `relocate`, `find_similar` and `__are_alike`, then run both implementations
over the same corpus using Scrapling **0.5.1** as the reference. Comparison is the **complete
per-candidate score table** plus the fingerprint dict — not just the winning element, because a port
can return the right element with every score subtly wrong.

**Result: ✅ PASS — 53/53 cases identical. No diffs in any score, fingerprint or result list.**

| Corpus | Cases | Purpose | Result |
|---|---|---|---|
| Curated | 9 | baseline, class rename, sibling insert, wrapper, id change, text change, table, similar-list, whitespace | 9/9 |
| Seeded fuzz | 40 | random trees + random mutations, deterministic seeds | 40/40 |
| Long / autojunk | 4 | >200-char text, >200-char attribute, 220 siblings, CJK | 4/4 |

### What the port had to get exactly right

| Requirement | Why it changes results |
|---|---|
| `difflib` **autojunk** | sequences ≥200 long purge "popular" elements from the index — ratios differ from a naive matcher |
| Python `round(x, 2)` | **banker's rounding**, not `Math.round`; scores are bucketed by this value, so ties change |
| `path` is a **tuple of tags**, not an XPath string | `('html','body','div','p')` compared with `SequenceMatcher` |
| `checks += max(len(orig), len(cand))` in `__are_alike` | penalises extra attributes; a `min` instead inflates scores |
| `element.text` means **own text**, not deep text | deep text would score every container as near-identical |

### Parser settings that must match

Scrapling does not parse with defaults:

```python
HTMLParser(recover=True, remove_blank_text=True, remove_comments=(not keep_comments),
           encoding="utf-8", compact=True, huge_tree=True, default_doctype=True)
```

and it strips the document first (`content.strip()`). `remove_blank_text` is a **no-op for HTML
`.text`**: libxml2's HTML parser keeps whitespace-only text nodes, so Scrapling's `.text` retains
them (verified against 0.5.1). Comments, by contrast, really are removed, and the WASM harness
drops comment nodes to emulate that. The WASM parser mirrors the flags (`NOBLANKS`, `HUGE`, UTF-8);
`NOBLANKS` is kept for intent, not because it changes HTML text.

### Port finding worth carrying forward

The spike wrapper keeps a single static document handle and frees the previous one on the next
`parse`. That produced **dangling pointers** mid-run: paths silently became empty strings, with no
crash. A real library needs explicit document handles (or an arena), and this is the same class of
bug as the interned-name corruption from S1b — silent, not loud.

**Verdict:** relocation is the differentiator, and it is exactly portable. No fuzzy-match library
substitution, no approximation layer.
