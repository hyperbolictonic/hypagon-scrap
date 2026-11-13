# Scrapling → Node.js — Research Index

**Status:** experimental (pre-1.0); P0–P4 done, Electron + binary transports proven — Hypagon integration next
**Last updated:** 2026-11-13
**Source target:** https://github.com/d4vinci/Scrapling (Python)
**Goal:** a reusable Node library that also hardens the research component of Hypagon Gateway

---

## Documents

| # | Document | Covers | Status |
|---|---|---|---|
| 00 | [State of play](00-state.md) | Current position, decisions, landmines — **read first** | ✅ live |
| 01 | [Source analysis](01-scrapling-source-analysis.md) | What Scrapling actually is, dependency map, problem inventory | ✅ done |
| 02 | [Transport: TLS & HTTP/2](02-transport-tls.md) | curl-impersonate wrappers, WASM analysis, Chromium, Electron `net` | ✅ done |
| 03 | [Parser: lxml parity](03-parser-lxml.md) | Why libxml2 ≠ HTML5, options matrix, `libxmljs2` findings | ✅ done |
| 04 | [Adaptive relocation](04-adaptive-relocation.md) | Both algorithms, scoring formula, options | ✅ done |
| 05 | [Spike log](05-spikes.md) | Pass/fail experiments and results | 🚧 in progress |
| 06 | [Architecture](06-architecture.md) | Library interfaces, reusability, Hypagon mapping | ✅ done |
| 07 | [Packaging & distribution](07-packaging.md) | The WASM gap on npm, publishing a libxml2-HTML build | ✅ done |
| 08 | [Implementation plan](08-implementation-plan.md) | Phased build plan, Electron/non-Electron routes, decisions | ✅ live |

---

## Decision summary

| Layer | Current decision | Confidence |
|---|---|---|
| Transport (static) | **Vendor a pinned lexiforest binary** + thin wrapper. Fingerprint proven identical to `curl_cffi` — do not build TLS | High — S2 pass |
| Transport (browser) | Chromium/`patchright` — affordable (≈102 MB, 160 ms/page). **Electron `net` emits a genuine Chromium fingerprint** | High — S3/S4 pass |
| Parser | **libxml2 2.11.9 → WASM, HTML enabled** — validated at 15/15 vs `lxml`. `libxmljs2` rejected (pinned 2.9.9) | High — S1b pass |
| Parser distribution | Publish the WASM build; no HTML-capable libxml2 exists on npm | Medium-high |
| Relocation | Faithful port of both algorithms, `Scorer` interface for embedding fallback | **High — S5: 53/53 exact scores** |
| Spiders | `crawlee`-shaped, defer | — |
| WASM | Only for pure-compute libxml2; **not** for TLS | High |

---

## The four findings that drive everything

1. **Scrapling implements no TLS.** `static.py` delegates to `curl_cffi`. The port question is
   therefore "is there a Node curl-impersonate", and the answer is yes, several. → [02](02-transport-tls.md)
2. **`lxml.html` is not an HTML5 parser.** Spec-compliant JS parsers are the *less* compatible
   choice. Only real libxml2 gives parity. → [03](03-parser-lxml.md)
3. **Relocation scores depend on parser-generated path strings.** Parser and relocation must be
   evaluated together, not independently. → [04](04-adaptive-relocation.md)
4. **JA3 cannot be compared for Chrome — GREASE randomises it per connection.** Measure JA4 +
   Akamai instead; a *stable* Chrome JA3 would itself be suspicious. → [02](02-transport-tls.md)

---

## Open questions

- [x] Does `libxmljs2` build or prebuild on Node 26 / 24? — **prebuild exists for 24; Node 26 fails**
- [x] Does libxml2 HTML repair match `lxml.html` on a malformed corpus? — **93%, fails on `<script>` via version skew**
- [x] Does a modern-libxml2 rebuild close the remaining gap? — **yes: 15/15 with WASM libxml2 2.11.9**
- [ ] Encoding policy for raw bytes (`Content-Type` / `<meta charset>`) vs the UTF-8 `str` path?
- [ ] Memory model for concurrent documents — explicit `free()` vs arena vs `FinalizationRegistry`?
- [x] Can relocation be reproduced exactly? — **yes: 53/53, including full score tables (S5)**
- [ ] Does relocation still match on real captured pages rather than synthetic ones?
- [ ] What is the WASM parse throughput vs `lxml` on large documents?
- [ ] WASM parse throughput vs `lxml` — unmeasured
- [x] Does Electron `net` produce a genuinely Chromium-family TLS fingerprint? — **yes: Akamai identical to Chrome; JA4 Chrome-structured (S4)**
- [ ] Why did Electron's JA4 alternate between 16 and 17 extensions across runs?
- [x] Is `patchright` too heavy to be a default path? — **no: ≈102 MB RSS, 160 ms for a simple page (S3)**
- [x] Which curl-impersonate wrapper is safe to depend on in production? — **none as shipped on Windows; vendor the pinned binary**
- [ ] CA-bundle strategy on Windows (BoringSSL ignores the OS store; `curl-cffi-node` has no CA option)
- [ ] Update/CVE cadence for the vendored curl-impersonate binary
- [ ] Is a Python sidecar acceptable in any deployment, or must artifacts be Node-only?
- [ ] Scope: core `Fetcher`/`Selector` only, or Spiders + AI too?

---

## Appendix: versions verified 2026-11-13

| Thing | Version |
|---|---|
| `patchright` | 1.64.3 |
| `@webcrawl/curl-impersonate` | 1.4.7 |
| `curl-cffi-node` | 0.1.8 |
| `cuimp` | 2.1.2 |
| `curl_cffi` (Python reference) | 0.17.0 |
| `curl-impersonate` (lexiforest binary) | 2.3.2 — `libcurl/8.15.0-IMPERSONATE BoringSSL` |
| `electron` | 45.3.1 — Chromium 156.0.8078.96 |
| Playwright Chromium (patchright) | 156.0.8078.4 (headless shell) |
| `libcurl.js` | 0.7.5 |
| `libxml2-wasm` | 0.7.2 |
| `@ai-ecoverse/wasm-libxml2` | 2.15.4-3 |
| `libxmljs2` | 0.37.0 |
| `scrapling` (reference) | 0.5.1 |
| `parse5` | 8.1.1 |
| `htmlparser2` | 12.0.0 |
| `crawlee` | 3.18.2 |
| `cheerio` | 1.2.0 |
| `tldts` | 7.5.1 |
| `xpath` | 0.0.36 |
| `wreq` (Rust) | 6.0.0-rc.31 |
| `boring` (Rust) | 5.5.0 |

### Built for S1b

| Thing | Version / size |
|---|---|
| Emscripten | 7.0.0 (`6afbd834…`) |
| libxml2 (WASM) | 2.11.9 — same engine as `lxml` 6.1.3 |
| Artifacts | `hx.wasm` 466.6 KB · `hx.mjs` 58.7 KB |
| Toolchain footprint | 714 MiB download · ~2.1 GB on disk |
