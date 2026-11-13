# 02 — Transport: TLS & HTTP/2 Fingerprinting

[← Index](index.md)

How the fetch layer gets a convincing browser fingerprint, and what is not worth building.

---

## The problem, stated precisely

JA3/JA4 is a hash of the **ClientHello bytes on the wire**: cipher order, extension order and
presence, curves, ALPN, signature algorithms. HTTP/2 has a parallel fingerprint (Akamai):
SETTINGS values and order, WINDOW_UPDATE, pseudo-header order, priority frames.

**JA3 is not comparable for Chrome.** Chrome sends GREASE (RFC 8701) — random reserved values
(`0x0a0a`…`0xfafa`) injected into the cipher and extension lists on every connection — so the
bytes being hashed change each time. Measured: **4 consecutive Chrome requests → 4 distinct JA3
hashes, 1 JA4, 1 Akamai.** JA4 ignores GREASE and sorts the lists, which is exactly why it exists.
Compare **JA4 + Akamai**; treat JA3 as a sanity signal only. Safari doesn't GREASE, which is why
its JA3 matched byte-for-byte across implementations.

**Rule:** the fingerprint belongs to whoever writes those bytes.

Scrapling doesn't write them — `curl_cffi` does. So the port needs an equivalent owner, not a
reimplementation. → [01](01-scrapling-source-analysis.md)

---

## Option A — curl-impersonate wrappers (recommended)

All of these wrap **lexiforest/curl-impersonate** — the same project `curl_cffi` binds to.
Fidelity is therefore 1:1 *by construction*.

| Package | Latest | Approach | S2 result on Windows |
|---|---|---|---|
| `@webcrawl/curl-impersonate` | 1.4.7 | Pinned binary, auto per-platform download, **sha256 verified** | ❌ **no Windows asset** — `assetForPlatform('win32','x64')` → `null`; every call throws `ImpersonateUnavailableError`, silently |
| `curl-cffi-node` | 0.1.8 | **napi-rs** in-process, libcurl 8.15.0-IMPERSONATE + BoringSSL | ✅ exact parity · ⚠️ **no CA-bundle option** (100 `CurlOpt` entries, none CA-related) → curl error 60 unless `verify:false` |
| `cuimp` | 2.1.2 | CLI wrapper, lexiforest binary 2.3.2 | ✅ exact parity · ⚠️ downloads binary **and CA bundle** from GitHub at runtime, **no hash verification** |
| `@m4eba/node-libcurl-impersonate` | 5.2.0 | Full libcurl bindings (node-gyp) | not tested — needs MSVC |

Also seen: `apify-node-curl-impersonate`, `node-curl-impersonate`, `ts-curl-impersonate`,
`@galihrivanto/node-libcurli`.

**Supply-chain caveat:** these ship a binary that terminates TLS. Pin exact versions, prefer the
sha256-verified download path, and vet maintainer track records before production.

### Non-options

| Approach | Why not |
|---|---|
| Node `undici` / `http2` | No JA3 control; H2 fingerprint is Node's |
| Hand-rolled HTTP/2 tuning | Pseudo-header order, SETTINGS, priority are library-owned |

---

## Option B — the WASM question

**An earlier claim in this project was wrong:** "WASM cannot spoof TLS." That is too absolute.

The accurate rule:

| Construction | Result |
|---|---|
| Host (Node/BoringSSL) performs the handshake | Fingerprint is the host's — WASM irrelevant |
| **Entire TLS+HTTP stack in WASM, host supplies raw TCP** | **Patched OpenSSL inside WASM writes ClientHello — fingerprint preserved** |

The second case works. Proof it ships: **`libcurl.js` 0.7.5** (49 versions since 2024-01) is
libcurl compiled to WebAssembly doing full TLS. In browsers it needs a WebSocket relay (no raw
TCP); **in Node `net.Socket` exists, so no relay is needed.**

**Cost:**

- Compile libcurl + patched OpenSSL + nghttp2 + brotli + zlib via emscripten → multi-MB artifact
- Custom curl transport shim over `net.Socket`
- Async bridge, per-record copying, single-threaded constraints
- You own the build forever

**What it buys:** one portable artifact instead of per-OS prebuilds — a *distribution* problem
the npm packages above already solve.

**Verdict:** possible and fingerprint-correct, but **no payoff today**. Revisit only if the
wrappers prove unmaintainable.

---

## Option C — Chromium as the fetcher

**Core insight:** Chromium's network stack produces a *genuine* Chrome ClientHello. Not an
imitation — the real thing. Impersonation profiles rot as Chrome evolves (ALPS, GREASE, ECH);
a current Chromium never rots.

| Dimension | curl-impersonate | Chromium (`patchright`) |
|---|---|---|
| Fingerprint authenticity | Mimic (high quality) | **Genuine** |
| Drift risk | Real — profile maintenance | None (tracks bundled Chromium) |
| Per-request cost | ≈60 ms spawn + network; 609 ms median to a WAN echo endpoint | ≈542 ms to the same endpoint; **160 ms** for a simple real page |
| Memory | 10–30 MB | **≈102 MB measured** (S3) |
| JS-rendered content | ✗ | ✓ |
| Turnstile-class | Partial | Best available |
| CDP detectability | n/a | Mitigated by `patchright` |

Measured values are from [05-spikes.md](05-spikes.md#s3--chromium-cost). Notably, the latency gap is
much smaller than assumed — the real cost of Chromium is memory and launch, not per-request time.

### Three traps

1. **`page.request` / `context.request` (`APIRequestContext`) does NOT use the browser's network
   stack.** It is a separate HTTP client → none of Chromium's TLS fingerprint. Only actual
   navigation counts.
2. **Headless does not change the TLS fingerprint.** The network service is shared with headful.
   Headless differences are at the JS/DOM/UA layer — which `patchright` patches.
3. **Cost must be engineered away:** reuse one browser, per-request contexts, `page.route`
   aborting images/fonts/media, bodies via CDP `Network.getResponseBody`.

---

## Option D — Electron `net` (host-dependent, unverified)

For Electron hosts (e.g. Hypagon Gateway), Electron's `net` module issues requests through
**Chromium's native networking library**, not Node's. If confirmed, that yields a genuine
Chromium-family TLS fingerprint in-process, with no external binary and no browser launch.

Caveats to verify:

- Electron's Chromium version differs from stable Chrome → fingerprint differs in degree
- Only available in Electron main-process contexts, not plain Node
- Needs a JA3/JA4 echo comparison against real Chrome and against `curl_cffi`

**This is the cheapest credible transport for an Electron consumer — spike it before vendoring a
binary.**

### S4 result (2026-11-13) — PASS

Electron 45.3.1 (Chromium **156.0.8078.96**), three `net.request` calls:

| Item | Value |
|---|---|
| Akamai H2 | `52d84b11737d980aef856699f885ca86` — **identical to real Chrome** |
| JA4 | `t13d1517h2_8daaf6152771_a87ad97598a9` — Chrome structure, same cipher hash, different extension hash |

So `net` does emit a genuine Chromium-family fingerprint. It is a *real* Chromium, not a mimic of a
pinned older build — which means it drifts with Electron's Chromium version instead of staying fixed.
One run reported 16 extensions instead of 17, so a single sample doesn't characterise a build.

**Consequence:** Hypagon needs no vendored binary, no external process, no CA-bundle workaround.

---

## Spike S2 result (2026-11-13) — PASS, with operational conditions

**Method:** fetch `https://tls.peet.ws/api/all` through each Node candidate and through Python
`curl_cffi` 0.17.0, then compare the **server-observed** JA4 and Akamai H2 hashes. The echo service
computes them from the actual handshake, so this measures the wire, not the library's claims.

**Reference targets** (`curl_cffi` 0.17.0, `impersonate=`):

| Impersonation | JA4 | Akamai H2 |
|---|---|---|
| `chrome` | `t13d1517h2_8daaf6152771_cb7bf5808d99` | `52d84b11737d980aef856699f885ca86` |
| `chrome131` | `t13d1516h2_8daaf6152771_02713d6af862` | `52d84b11737d980aef856699f885ca86` |
| `safari` | `t13d2013h2_a09f3c656075_7f0f34a4126d` | `c52879e43202aeb92740be6e8c86ea96` |

**Match results:**

| Candidate | chrome | chrome131 | safari | Verdict |
|---|---|---|---|---|
| `cuimp` 2.1.2 → lexiforest **2.3.2** | ✅ | ✅ | ✅ (JA3 identical too) | fingerprint closed |
| `curl-cffi-node` 0.1.8 | — (no alias) | ✅ | not tested | fingerprint closed |
| `@webcrawl/curl-impersonate` 1.4.7 | ❌ | ❌ | ❌ | unusable on Windows |

**Latency** (5 sequential requests, same endpoint): `cuimp` **609 ms** median, `curl-cffi-node`
**548 ms**. WAN RTT to the echo service (~500 ms) dominates; subprocess spawn adds ≈60 ms.

### What this settles

Fidelity is **1:1 by construction and now confirmed empirically**: every working candidate wraps
lexiforest, the same project `curl_cffi` binds to. There is no fingerprint to invent and nothing to
improve by compiling BoringSSL yourself.

### What this does *not* settle — none is production-ready on Windows as shipped

| Gap | Impact | Fix |
|---|---|---|
| `@webcrawl` has no Windows asset | Fails at runtime, silently | Exclude on Windows |
| `curl-cffi-node` cannot set a CA path | `verify:false` or nothing — TLS verification impossible on Windows | Linux only, or patch |
| `cuimp` verifies only "is executable" | Binary + CA bundle downloaded from GitHub at runtime with **no hash check** | Vendor the binary ourselves |

**Therefore:** vendor a pinned lexiforest binary (v2.3.2, MIT) and write a thin wrapper. That is
"build our own" in the sense that matters — wrapper, provenance, update cadence — while compiling
TLS would need BoringSSL + Go + NASM + MSVC, none of which are present here, and would change
nothing observable on the wire.

---

## Recommendation

| Consumer | Transport |
|---|---|
| Reusable standalone library — Windows | **Vendored, pinned lexiforest binary + own thin wrapper**; `cuimp` as a stopgap |
| Reusable standalone library — Linux | `curl-cffi-node` (in-process, ~10% faster) once CA handling is confirmed |
| Electron host (Hypagon) | **Electron `net`** — S4 confirmed a genuine Chromium fingerprint; no binary needed |
| JS-heavy / hard anti-bot | `patchright` hybrid path |

Ship a **`Transport` interface** with peer implementations so consumers choose. Do not build TLS:
S2 proves the prebuilt binary reproduces `curl_cffi` exactly, so compiling it would add maintenance
and change nothing observable on the wire.
