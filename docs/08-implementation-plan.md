# 08 — Implementation Plan

[← Index](index.md)

Research is complete; every architectural unknown is measured. This is the build plan.

| Evidence | Result |
|---|---|
| Parser | libxml2 2.11.9 → WASM, **15/15** vs `lxml` 6.1.3 ([03](03-parser-lxml.md)) |
| Transport | prebuilt lexiforest binary matches `curl_cffi` **exactly** on JA4 + Akamai ([02](02-transport-tls.md)) |
| Electron | `net` emits a genuine Chromium fingerprint ([05](05-spikes.md#s4--electron-net-fingerprint)) |
| Chromium fallback | ≈102 MB RSS, 160 ms/page ([05](05-spikes.md#s3--chromium-cost)) |
| Relocation | **53/53**, full score tables exact ([04](04-adaptive-relocation.md)) |

---

## The Electron question, answered first

**Yes — and the non-Electron route is the simpler one.** Electron's `net` is one *transport
implementation*, not a dependency of the library.

```
                 ┌─────────────────────────────┐
                 │  core: Selector + Relocation │   ← always available
                 │  parser: WASM libxml2        │   ← always available
                 └──────────────┬──────────────┘
                                │ Transport interface
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
 ElectronNetTransport   CurlImpersonateTransport   PatchrightTransport
 (Electron main only)   (any Node, vendored bin)   (any Node, optional peer)
```

| | Plain Node | Electron |
|---|---|---|
| Parser | WASM — identical | WASM — identical |
| Relocation | identical | identical |
| Default transport | **vendored lexiforest binary** | `net` (no binary needed) |
| Fallback transport | `patchright` | vendored binary |
| Native build needed | none | none |

Consequences for the design:

1. **No hard dependency on Electron.** `electron` is an *optional peer*; the transport module
   dynamically imports it only when `process.versions.electron` is present. A plain Node install
   never loads it.
2. **The vendored binary works inside Electron too.** `net` is a convenience, not a requirement —
   so if its fingerprint ever becomes a liability, switching is a config change.
3. **Fingerprints differ between the two routes, deliberately.** `net` tracks Electron's bundled
   Chromium (156.x today); the binary tracks the pinned impersonation profile. Both read as
   Chrome-family, but they are not identical. Document it rather than pretend otherwise.
4. **The binary route should stay the reference implementation.** It is what `curl_cffi` does, and
   S2 proved wire-level equality. `net` is validated as Chromium-family, not as byte-identical.

---

## Progress

| Phase | Status |
|---|---|
| P0 scaffold | ✅ done — npm workspaces, shared tsconfig, `packages/` + `test/` split |
| P1 parser | ✅ done — multi-document handles, 12/12 unit tests, S5 corpus re-run at 53/53 |
| P2 selector + CSS | ✅ CSS 250/250 + text helpers 33/33; serialisation pending |
| P3 transport | ✅ Electron live (14/14) + binary fingerprint parity; patchright pending |
| P4 relocation | ✅ integrated into `packages/core`; 53/53 parity in CI |
| P5 packaging | ◐ licences, metadata, CI and pack gate done; binary model open |
| P6–P7 | ⬜ |

## Phases

Dependencies: **P1 → P2 → P4**, with **P3 parallel to P2**, **P5 after P1**, **P6 after P3+P4**.

**Build order chosen: P0 → P1 → P3 (Electron first) → P2 → P4.** Electron is the quickest vertical
slice: `net` needs no vendored binary, no CA bundle and no subprocess, so an end-to-end path exists
on day one. The binary transport follows immediately after, proving the interface is genuinely
swappable rather than Electron-shaped.

### P0 — Scaffold

Monorepo (npm workspaces), TypeScript, ESM + CJS builds, vitest, lint/format.

```
packages/
  libxml2-html-wasm/    # parser artifact + typed API
  core/                 # selector, transport, relocation
```

**Done when:** `npm test` runs green in CI and both packages build from clean checkout.

---

### P1 — Parser package

The only genuinely unresolved design decision. The spike holds **one static document** and frees it
on the next `parse`, which silently dangles pointers (see S5).

| Task | Detail |
|---|---|
| Multi-document handles | `parse()` returns an opaque `Doc`; every call takes `Doc`. No module-level state |
| Lifetime | explicit `doc.dispose()`; `FinalizationRegistry` as a safety net, never as the primary path |
| Leak guard | dev-mode counter: docs created vs disposed; test asserts zero after 10k cycles |
| Encoding | `utf8` \| `auto` (honour `<meta charset>` / caller-supplied `Content-Type`) |
| Comment policy | `dropComments` option (Scrapling defaults to dropping) |
| API surface | `parse`, `root`, `type/name/text/ownText/attrs/children/parent`, `xpath`, `path` |

**Done when:** S1b corpus still 15/15; two concurrent documents parse and query correctly; 10k
parse/dispose cycles show flat RSS; throughput recorded against `lxml`.

**Status: done for the parts that gate P2.** `parse()` returns an owned document, `dispose()` is
explicit, a `FinalizationRegistry` is the safety net only, and node handles throw after disposal
instead of reading freed memory. Tests cover concurrent documents, disposal, resource management
and 300 parse/dispose cycles.

Two findings from doing it:

- **`remove_blank_text` is a no-op for HTML.** Scrapling passes it, but libxml2's HTML parser keeps
  whitespace-only `.text` — verified against 0.5.1. The port matches by *keeping* the whitespace.
  An earlier note claiming it produced `None` was wrong and has been corrected in `00` and `05`.
- **Rebuilding the wrapper does not disturb relocation parity.** The S5 harness accepts an
  alternate build via `HX_MODULE`; the packaged multi-document artifact reproduces all 53 cases
  (9 curated, 40 fuzz, 4 autojunk) with identical score tables.

Remaining for P5: RSS/throughput measurement against `lxml` on large documents.

---

### P2 — Selector + CSS layer

The **largest unestimated piece**. Scrapling uses Python `cssselect` to translate CSS → XPath; JS
DOM libraries have different semantics, so this cannot be swapped blindly.

| Task | Detail |
|---|---|
| `Selector` API | `css`, `xpath`, `find_all`, `find_by_text`, `text`, `attrib`, `html_content`, `get_all_text` |
| CSS→XPath | port `cssselect`'s translator (or vendor an equivalent and prove parity on a selector corpus) |
| Text conveniences | `get_all_text` visibility rules, `prettify`, `find_by_regex` |
| Paths | expose `path()` for relocation and debugging |

**Done when:** CSS/XPath selection matches Scrapling on a selector corpus (elements and order), and
`get_all_text` matches on the same pages.

**Status: CSS translator done for the scraping-critical subset.** Validated by **selected nodes**
against cssselect 1.6.0: **250/250** (50 selectors × 5 documents). Comparing results rather than
XPath strings was deliberate — the port emits simpler equivalent axes
(`/descendant::`, `/following-sibling::*[1]/self::…`), and string equality would have forced
copying implementation details instead of behaviour.

Supported: type/universal, `.class`, `#id`, all attribute operators including `|=` and `!=` (with
`i`/`s` flags), combinators (` `, `>`, `+`, `~`), groups, `:not()`, `:root`, `:empty`,
`:first/last/only-child`, `:first/last/only-of-type`, the four `:nth-*` forms, `:checked`, `:link`,
`:contains()`, `:lang()`, the never-matching interaction pseudos, and `::text` / `::attr()`.

Deliberately **not** supported, and throwing `CssSelectorError` rather than diverging: namespace
prefixes, escaped identifiers, `:disabled`/`:enabled` (cssselect's fieldset-ancestry logic is long
and easy to get subtly wrong), `:is()`/`:where()`/`:has()`, and other pseudo-elements.

**Status: CSS and text helpers done.** Text is validated **33/33** against Scrapling
(`get_all_text` variants, `find_by_text`/`find_by_regex` option combinations, scoped selectors,
tail-text negatives). Comparisons are exact strings and result paths.

The findings that matter for consumers:

- **`.text` is own text** (lxml's `element.text`), not subtree content. `getAllText()` is the deep
  walk. Scrapling does the same, and both `find_by_text` and relocation depend on it.
- **`clean_match` cleans the element text, not the query**, so `find_by_text("Widget  100")` finds
  nothing while `find_by_text("Widget 100")` works. Preserved because parity beats intuition.
- **Text extraction stops at clean text.** Markdown conversion and context budgeting stay in the
  consumer (Hypagon's markdown/context layer); the library does not add a second, competing format.

---

### P3 — Transport

| Task | Detail |
|---|---|
| Interface | `request(url, opts) → { status, headers, body, url, timing }`; cookies, proxy, redirects, timeout |
| `CurlImpersonateTransport` | vendored pinned binary; SHA256 verified at install/build; ships CA bundle |
| `ElectronNetTransport` | dynamic import, main-process only, maps `net.request` onto the interface |
| `PatchrightTransport` | optional peer; browser reuse, per-request contexts, abort images/fonts/media |
| Resolver | explicit config wins; otherwise `process.versions.electron ? net : binary` |

**Done when:** the S2 matrix is a regression test (recorded reference hashes; JA4 + Akamai compared,
JA3 ignored for Chrome); a plain-Node test asserts `electron` is never imported; binary provenance
is pinned and verified.

**Status: Electron path done, binary path pending.** `ElectronNetTransport` targets a *structural*
`net` interface, so it is unit-tested with a fake (options, headers, body, chunked response,
timeout/abort, error). `createElectronNetTransport()` imports Electron through a non-literal
specifier, so TypeScript never needs Electron's types and plain Node never loads it; it fails with
an explanatory error outside Electron. A live Electron run is still owed.

**Status: both transport paths are done.** Electron is proven live; the binary route is vendored and
fingerprint-verified.

The binary route (`packages/core/src/transport/curl-impersonate.ts`) drives a pinned lexiforest build
as a subprocess. `scripts/fetch-curl-impersonate.mjs` pins version `2.3.2`, the exact asset per
platform, and a SHA-256 per target taken from GitHub's published asset digests (the win32-x64 hash
was independently reproduced). A mismatch deletes the download; there is no postinstall hook and no
unverified execution.

Fingerprint parity, compared against the S2 `curl_cffi` reference:

| Profile | JA4 | Akamai H2 |
|---|---|---|
| chrome131 | `t13d1516h2_8daaf6152771_02713d6af862` — **exact** | `52d84b…ca86` |
| chrome152 | `t13d1517h2_8daaf6152771_cb7bf5808d99` — **exact** | `52d84b…ca86` |

Known limits: one process per request, no proxy option in the interface yet, and HEAD handled
specially because `-I` writes headers into the output stream. `NativeCA` in this build removes the
Windows CA-bundle trap that made `curl-cffi-node` unusable in S2.

---

### P4 — Relocation

Port already exists and passes 53/53; this phase integrates and hardens it.

| Task | Detail |
|---|---|
| Integrate | `js/relocation.mjs` + `js/difflib.mjs` → typed package |
| Fixtures | move the 53 cases + generator into the test suite |
| Index optimisation | candidate indexing; must prove identical results, not "close enough" |
| `Scorer` interface | structural scorer default; embedding scorer opt-in (Hypagon has `onnxruntime`) |

**Done when:** 53/53 in CI; unchanged-document property returns the original element at 100%;
indexed variant produces byte-identical results to the naive scan.

**Status: done.** The port lives in `packages/core/src/relocation/` and operates on the packaged
parser's `HtmlNode` API (not raw pointers). `TreeIndex` is built once per `Page` and cached, and
uses an iterative pre-order walk so deep documents cannot blow the call stack. The 53 goldens run in
CI, comparing the fingerprint, the entire score table, `relocate` and both `find_similar` lists.

---

### P5 — Packaging

| Task | Detail |
|---|---|
| Publish parser | version mirrors upstream (`2.11.9-1`); prebuilt `.wasm` committed or attached, never built on install |
| CI | emsdk cached; parity gate against `lxml`; SHA256 published |
| Core package | optional peers (`electron`, `patchright`); no postinstall compilation |
| Docs | memory contract and fingerprint expectations stated explicitly |

**Done when:** a clean machine with no Python, no MSVC and no emsdk can install and parse.

**Status: release-gated (2026-11-13).** A packaging pass was done ahead of Hypagon integration
because the binary model would otherwise cause churn.

| Item | State |
|---|---|
| Package names | `hypagon-scrap`, `hypagon-scrap-libxml2` |
| Licence | MIT `LICENSE` + `NOTICE`, with upstream texts vendored under `packages/*/LICENSE_*.txt` |
| Attribution | Scrapling (BSD-3, Karim shoair), CPython `difflib` (PSF), libxml2 (MIT), curl-impersonate (MIT) |
| Metadata | `engines`, `keywords`, `exports`, `bin`, `files`; `repository` deliberately unset until the public repo exists |
| Deterministic pack | WASM artifact committed; `prepack` builds and verifies it |
| Pack gate | `npm run pack:check` packs, installs tarballs into a clean project and runs the library |
| CI | Windows + Ubuntu, Node 20/22/24, tests plus the pack gate |
| Binary in tarball | **not** included; `hypagon-scrap-fetch-curl` downloads and verifies it |

Remaining before publish: choose the binary distribution model (platform packages vs the explicit
fetch CLI), set `repository`, and run cross-platform tests (only win32-x64 has been executed here).

---

### P6 — Hypagon integration

| Task | Detail |
|---|---|
| Swap research fetcher/parser | use core package; `net` transport in Electron |
| Parity check | N captured pages: same selections, same relocation scores |
| Measure | latency, RSS, relocation hit rate before/after |

**Done when:** Hypagon's research component runs entirely on the library with recorded parity.

---

### P7 — Hardening (ongoing)

- Real-page corpus for parser **and** relocation
- CVE rebuild cadence for libxml2 and the curl-impersonate binary
- Performance work only after correctness is locked

---

## Sequencing at a glance

| Phase | Size | Risk |
|---|---|---|
| P0 scaffold | S | none |
| P1 parser | M | **memory model** — silent failures if wrong |
| P2 selector + CSS | **L** | **CSS→XPath parity is the biggest unknown in the project** |
| P3 transport | M | supply chain (binary provenance) |
| P4 relocation | S–M | low; already validated |
| P5 packaging | M | CI toolchain |
| P6 Hypagon | M | integration, not architecture |
| P7 hardening | ongoing | CVE pressure |

## Decisions needed before P1

1. **Memory model** — explicit handles + finalizer safety net (recommended) vs arena.
2. **CSS→XPath** — port `cssselect` (parity, more work) vs vendor and prove parity.
3. **Publish publicly** or private registry? `07` argues the parser niche is empty.
4. **Package naming** — parser package name sets discoverability.
5. **Electron auto-detection** — silent default, or require explicit `transport: "electron"`?
