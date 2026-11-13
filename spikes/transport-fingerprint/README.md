# Spike S2 — Transport fingerprint parity

Does a Node wrapper around `lexiforest/curl-impersonate` put the same bytes on the wire as Python
`curl_cffi`? **Yes — two of three candidates match exactly.**

| Candidate | Windows | chrome | chrome131 | safari | Median latency |
|---|---|---|---|---|---|
| `cuimp` 2.1.2 → lexiforest 2.3.2 | ✅ | ✅ | ✅ | ✅ | 609 ms |
| `curl-cffi-node` 0.1.8 (napi) | ✅* | — | ✅ | not tested | 548 ms |
| `@webcrawl/curl-impersonate` 1.4.7 | ❌ | ❌ | ❌ | ❌ | — |

\* works only with `verify:false` — no CA-bundle option on Windows.

---

## Reproduce

```powershell
# reference side
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install curl_cffi
.\.venv\Scripts\python.exe py-side.py out-python.json

# Node side
npm init -y
npm install cuimp @webcrawl/curl-impersonate curl-cffi-node
node node-cuimp.mjs        # downloads the binary + CA bundle on first run
node node-cffi.mjs         # needs verify:false on Windows (see below)
node node-webcrawl.mjs     # expected to fail on Windows
```

`tls.peet.ws/api/all` computes JA3/JA4/Akamai **from the handshake**, so results describe the wire,
not the library's claims. It rate-limits: the scripts retry with backoff.

---

## Result detail

Reference `curl_cffi` 0.17.0:

| Impersonation | JA4 | Akamai H2 |
|---|---|---|
| `chrome` | `t13d1517h2_8daaf6152771_cb7bf5808d99` | `52d84b11737d980aef856699f885ca86` |
| `chrome131` | `t13d1516h2_8daaf6152771_02713d6af862` | `52d84b11737d980aef856699f885ca86` |
| `safari` | `t13d2013h2_a09f3c656075_7f0f34a4126d` | `c52879e43202aeb92740be6e8c86ea96` |

`cuimp` (chrome152 / chrome131 / safari270) matched every one. Safari matched **byte-for-byte on
JA3 too**.

---

## Gotchas

1. **JA3 is unusable as a comparison metric for Chrome.** GREASE (RFC 8701) injects random reserved
   values (`0x0a0a`…`0xfafa`) into the cipher/extension lists, so the hashed bytes change per
   connection. Measured: 4 runs → 4 JA3 hashes, 1 JA4, 1 Akamai (`node-grease-test.mjs`). Compare
   **JA4 + Akamai**. Safari doesn't GREASE — hence its stable JA3.
2. **`@webcrawl` has no Windows asset.** `assetForPlatform('win32','x64')` → `null`; calls throw
   `ImpersonateUnavailableError`. Its `ensureImpersonate()` also returns `null` rather than erroring,
   so the failure is silent until the first request.
3. **`curl-cffi-node` cannot verify TLS on Windows.** BoringSSL ignores the OS cert store and the
   binding exposes no CA path (100 `CurlOpt` entries, none CA-related). `CURL_CA_BUNDLE` is ignored.
   Only `verify:false` works. Fine for a fingerprint test, unacceptable for production.
4. **`cuimp`'s "verify" is not integrity verification.** It checks the binary exists and is
   executable, then downloads binary + CA bundle from GitHub at runtime with no hash check.
5. **`cuimp`'s `timeout` is in milliseconds**, unlike most Node HTTP clients. `timeout: 30` fails
   instantly.

---

## Files

| File | Role |
|---|---|
| `py-side.py` | reference targets via `curl_cffi` (`chrome`, `chrome131`, `safari`) |
| `node-cuimp.mjs` | candidate A across 4 descriptors |
| `node-cffi.mjs` | candidate C (napi binding) |
| `node-webcrawl.mjs` | candidate B — expected failure on Windows |
| `node-grease-test.mjs` | proves JA3 instability is GREASE, not a real difference |
| `node-latency.mjs` | subprocess vs in-process cost |
