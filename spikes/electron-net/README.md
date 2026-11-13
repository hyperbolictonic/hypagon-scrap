# Spike S4 — Electron `net` fingerprint

Does Electron's `net` module emit a genuine Chromium-family TLS/HTTP2 fingerprint? **Yes.**

| Item | Value |
|---|---|
| Electron | 45.3.1 |
| Chromium | 156.0.8078.96 |
| Akamai H2 | `52d84b11737d980aef856699f885ca86` — **identical to real Chrome** |
| JA4 | `t13d1517h2_8daaf6152771_a87ad97598a9` |
| Per request | 738–886 ms (WAN-dominated) |

JA4 matches Chrome's *structure* — same `t13d1517h2` prefix, same cipher-list hash `8daaf6152771`,
15 ciphers — and differs only in the extension hash. That difference is expected: Electron bundles
Chromium 156, whereas `curl_cffi`'s `chrome` profile imitates a pinned older build.

**Consequence:** an Electron host (Hypagon) needs no vendored curl-impersonate binary, no external
process and no CA-bundle workaround.

---

## Run

```powershell
npm init -y
npm install electron
npx electron main.js
```

First run downloads the Electron runtime (~100 MB).

---

## Gotchas

1. **`net` only works in the main process, after `app.whenReady()`.** Not available in renderers or
   plain Node.
2. **JA4 varied across runs** (16 vs 17 extensions) on the first request — likely warm-up state
   (ALPS/ECH). One sample does not characterise a build.
3. **It is not byte-identical to `curl_cffi`'s profile.** It is a *real* Chromium, so it drifts with
   Electron's Chromium version instead of staying pinned. Arguably stronger, but not a drop-in
   equivalence claim.

## Files

| File | Role |
|---|---|
| `main.js` | three `net.request` calls to `tls.peet.ws/api/all`, prints JA4/Akamai stability |
