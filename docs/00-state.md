# 00 — State of Play

[← Index](index.md)

**Read this first after any context loss.** It records what is settled, what is not, and the
non-obvious facts that cost time to discover. Topic docs (01–07) hold the reasoning; this holds the
position.

**Last updated:** 2026-11-13

---

## Objective

Port Scrapling (Python) to Node as a **reusable library**, which also hardens the research component
of **Hypagon Gateway** (Electron + LanceDB + `onnxruntime-node`). Must not be Hypagon-specific.

---

## Where things stand

| Spike | Question | Result |
|---|---|---|
| S1 | Does `libxmljs2` match `lxml.html`? | ❌ 93% — pinned to libxml2 **2.9.9** (2019) |
| S1b | Does a self-built libxml2 2.11.9 WASM close it? | ✅ **15/15** |
| S2 | Do Node wrappers match `curl_cffi` on the wire? | ✅ 2 of 3, exact JA4 + Akamai |
| S3 | Is `patchright` cheap enough to be the default? | ✅ **≈102 MB RSS, 166 ms cold, 160 ms/page** |
| S4 | Does Electron `net` give a Chromium-family fingerprint? | ✅ Akamai identical to Chrome |
| S5 | Can relocation be reproduced exactly? | ✅ **53/53 — exact score tables** |

---

## Decisions locked

| Layer | Decision | Evidence |
|---|---|---|
| Parser | **libxml2 2.11.9 compiled to WASM**, HTML enabled | S1b: 15/15 vs `lxml` 6.1.3 |
| Parser (rejected) | `libxmljs2` — 93%, latent divergence grows | S1 |
| Transport | **Vendor a pinned lexiforest binary + thin wrapper.** Do not compile TLS | S2 |
| Transport (Windows) | No npm package is production-ready: `@webcrawl` has no Windows asset, `curl-cffi-node` cannot verify TLS | S2 |
| Transport — Electron host | **Electron `net`** — genuine Chromium fingerprint, no binary, no CA problem | S4 |
| Transport — browser fallback | `patchright` is affordable (~102 MB, 160 ms/page); use for JS-rendered and hard anti-bot targets | S3 |
| Relocation | Faithful port of both algorithms; `Scorer` interface for optional embedding | S5: 9/9 curated, 40/40 fuzz, 4/4 autojunk — **exact** |
| Distribution | Publish the WASM parser as its own package — the niche is empty | 07 |

---

## Open decisions

- **Memory model** for the WASM parser: explicit `free()` vs arena-per-document vs
  `FinalizationRegistry`. The spike's single static `last_doc` will not survive concurrency.
- **Encoding policy**: UTF-8 `str` path vs raw bytes honouring `Content-Type` / `<meta charset>`.
- **CA bundle on Windows**: BoringSSL ignores the OS store; whatever we vendor must ship one.
- **Binary update cadence** for the vendored curl-impersonate (CVE pressure).
- **Corpus size** before parity is publishable (15 cases is a smoke test).
- **Scope**: core `Fetcher`/`Selector` only, or Spiders + AI too?

---

## Machine facts (these have already cost time)

| Fact | Detail |
|---|---|
| Node | **v26.1.0** global at `C:\Program Files\nodejs`. v24.22.3 exists under `nvm` but is **not on PATH** |
| npm | **12.2.1** — blocks native install scripts by default (`npm install-scripts approve`) |
| Compilers | **No MSVC, clang, gcc, cmake, make** |
| Emscripten | Installed at `~/emsdk` (~2.1 GB). `emcc.exe` at `~/emsdk/upstream/emscripten/emcc.exe` |
| Python | 3.14 default (`C:\Python314`); 3.12 and 3.10 also present |
| Shell | **`pwsh` is NOT installed** — use `powershell -ExecutionPolicy Bypass -File`. Git Bash is available |
| Disk | ~73 GB free |

---

## Artifacts

| Path | Contents |
|---|---|
| `spikes/libxml2-parity/` | 15-case corpus, `py-side.py` (lxml 6.1.3 venv), `node-side.js` (libxmljs2), `compare.js` |
| `spikes/libxml2-wasm/` | `hx.wasm` 466 KB + `hx.mjs` 59 KB, `build.ps1` (verified), `gen-headers.js`, `wasm-side.mjs` |
| `spikes/transport-fingerprint/` | `py-side.py` + `node-cuimp/cffi/webcrawl/grease/latency.mjs`, venv with `curl_cffi` 0.17.0 |

Verify parser parity: run `wasm-side.mjs`, then `compare.js out-wasm.json ../libxml2-parity/out-python.json`.

---

## Landmines

Do not rediscover these:

1. **Never `xmlFree` interned node names.** They live in the document dictionary; freeing corrupts it
   silently — XPath then returns zero results and names become mojibake.
2. **Walk from the root element, not the `xmlDoc`.** `lxml`'s `document_fromstring` returns `<html>`
   and callers iterate its children, so the first node is `<body>`.
3. **libxml2 defaults charset-less HTML to ISO-8859-1.** `lxml` passes UTF-8 because it takes a
   `str`. Omitting the encoding mojibakes CJK.
4. **JA3 cannot be compared for Chrome.** GREASE (RFC 8701) randomises the hashed bytes —
   4 runs → 4 JA3, 1 JA4, 1 Akamai. Compare **JA4 + Akamai**.
5. **`cuimp`'s `timeout` is milliseconds.** `timeout: 30` fails instantly.
6. **`@webcrawl` has no Windows asset** and fails *silently* (`ensureImpersonate()` returns `null`).
7. **`curl-cffi-node` cannot verify TLS on Windows** — no CA option, `CURL_CA_BUNDLE` ignored;
   curl error 60 unless `verify:false`.
8. **`tls.peet.ws` rate-limits** — retry with backoff.
9. **libxml2 build**: `xmlversion.h` and `config.h` are `configure` outputs (generate them); exclude
   `nanoftp.c`, `runsuite.c`, `runxmlconf.c` (each defines `main()`).
10. **`node-gyp` routes are dead here** — no MSVC. Prefer WASM or prebuilt binaries.
11. **Scrapling does not parse with defaults.** `recover`, `remove_blank_text=True`,
    `remove_comments=True`, `huge_tree=True`, `encoding="utf-8"`, and `content.strip()` first.
    `remove_blank_text` is a **no-op for HTML `.text`** — libxml2 keeps whitespace-only text
    (verified against 0.5.1), so do not "fix" it. Comments *are* removed, post-parse.
12. **Relocation `path` is a tag tuple**, not an XPath string — `('html','body','div','p')`.
13. **Python `round(x, 2)` is banker's rounding.** Scores are bucketed on it; `Math.round` diverges
    on ties.
14. **One static document handle is not enough.** Parsing a second document frees the first and
    leaves dangling pointers that silently produce empty strings. **Fixed in
    `packages/libxml2-html-wasm`:** documents are owned handles, and node access after disposal
    throws.

---

## Next actions, in order

P0–P4 are done. Transports: Electron proven live (14/14), binary vendored with exact JA4 parity.
The project is **experimental / pre-1.0** and packaging is now release-gated.

1. **Hypagon integration** — `net` transport + `getAllText()` into the existing markdown/context
   layer; measure latency, RSS and relocation hit rate before/after.
2. **Public repo** — `https://github.com/hyperbolictonic/hypagon-scrap` (repository fields set);
   CI (`.github/workflows/ci.yml`) and `npm run pack:check` are in place.
3. **Publish** — parser first, then core (`hypagon-scrap` depends on `hypagon-scrap-libxml2@0.1.0`).
   Publishing is blocked until the binary distribution question is settled (see [07](07-packaging.md)).
