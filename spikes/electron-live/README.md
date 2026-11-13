# Spike â€” live Electron host test

Does `hypagon-scrap` actually work inside Electron, or only in unit tests
with a fake `net`?

**Yes â€” 14/14 checks in Electron 45.3.1 / Chromium 156.0.8078.96.**

This is the difference between "implemented" and "proven": it exercises the
public factory (`createElectronNetTransport`), the transport, the WASM parser,
CSS selection, fingerprints, relocation and `findSimilar` in a real main process.

## Run

Uses the Electron install from `spikes/electron-net`:

```powershell
Set-Location <repo root>
.\spikes\electron-net\node_modules\electron\dist\electron.exe .\spikes\electron-live\main.cjs
```

Exit code is `0` only when every check passes.

## What it checks

| Area | Checks |
|---|---|
| ESM | dynamic import of `packages/core/dist/index.js` from a CJS main |
| Factory | `createElectronNetTransport()` imports Electron itself and returns a transport |
| Transport | 200 status, headers, body, elapsed time, reuse across requests |
| Parser | WASM loads in Electron; CSS selects the expected elements |
| Relocation | fingerprint built; `relocate` finds the element after markup drift |
| Similarity | `findSimilar` returns the structural sibling |
| Fingerprint | JA4 + Akamai via `tls.peet.ws` **through the wrapper** |

Local requests run against an in-process `node:http` server, so the core path is
deterministic. The external probe is allowed to fail (network), and reports
`SKIP` rather than failing the run.

## Observed fingerprint

```
ja4    = t13d1516h2_8daaf6152771_806a8c22fdea
akamai = 1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p
ua     = Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 â€¦
```

`tls.peet.ws` now reports the Akamai H2 fingerprint in its structured
`settings|window|priority|pseudo-headers` form rather than the MD5 hex used in
S4. Both describe the same Chromium stack; S4's hex
(`52d84b11737d980aef856699f885ca86`) remains the comparable value.

JA4 here has 16 extensions; S4 observed 16 and 17 across runs. That variance is
the pre-existing ALPS/ECH warm-up note, not a regression from the wrapper.

## What this does not prove

- The **non-Electron** route (vendored curl-impersonate binary) â€” separate work.
- Packaging: this imports `dist/` from the repo, not an installed package.
- Behaviour with proxies, cookies, client certificates, or large streaming bodies.
