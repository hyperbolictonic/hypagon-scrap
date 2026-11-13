# Vendored curl-impersonate binary

The non-Electron transport: a pinned curl-impersonate build, verified before use,
driven as a subprocess by `CurlImpersonateTransport`.

**Result: chrome131 and chrome152 reproduce the S2 `curl_cffi` fingerprint exactly.**

| Profile | JA4 | Reference | Akamai H2 hash |
|---|---|---|---|
| chrome131 | `t13d1516h2_8daaf6152771_02713d6af862` | exact match | `52d84bâ€¦ca86` |
| chrome152 | `t13d1517h2_8daaf6152771_cb7bf5808d99` | exact match | `52d84bâ€¦ca86` |
| chrome151 | `t13d1516h2_8daaf6152771_806a8c22fdea` | no reference (reported) | `52d84bâ€¦ca86` |

Akamai H2 settings are identical across all Chrome profiles, as expected; JA4 is
the discriminator, and it matches `curl_cffi` byte for byte.

## Reproduce

```powershell
# installs into packages/core/bin/<platform>-<arch>/ and verifies SHA-256
npm run fetch:curl -w hypagon-scrap

# fingerprint comparison against the S2 reference
node spikes/curl-binary/verify.mjs
```

`tls.peet.ws` rate-limits; `verify.mjs` retries three times with a 2 second
backoff. A reset is not a wrapper failure â€” it was observed on the first attempt
and passed on retry.

## Supply chain

| Rule | Implementation |
|---|---|
| Pinned version | `2.3.2`, in `packages/core/scripts/fetch-curl-impersonate.mjs` |
| Pinned artifact | exact asset name per platform |
| Verified before execution | SHA-256 checked before extraction; mismatch deletes the download |
| Hashes sourced | GitHub's published per-asset `digest`; win32-x64 independently reproduced |
| No install-time network | there is **no** postinstall hook; `fetch:curl` is explicit |

Supported targets: `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`. Any other platform fails with an explicit message rather than
downloading something unverified.

## Why not `cuimp`

S2 showed `cuimp` matches the fingerprint, but it downloads the binary from
GitHub **at runtime with no hash check**, and its `verifyBinary` only checks that
the file is executable. That is the supply-chain problem this script exists to
avoid.

## Behaviour notes

- **One process per request.** Simple and isolated; process startup is part of
  the cost. Pooling is possible later but not needed to be correct.
- **CA handling:** this build reports `NativeCA`, so HTTPS works on Windows
  without a bundle (verified against `example.com`). A `caBundle` option maps to
  `--cacert` for environments that need an explicit store.
- **`--impersonate chrome` is invalid** in this build; targets are explicit
  (`chrome131`, `chrome152`, â€¦). The transport defaults to `chrome131` for
  parity with the S2 reference.
- **HEAD:** `-I` writes response headers into the output file, so the transport
  returns an empty body for HEAD by construction.
- **Redirects:** `-L` is used; the last header block is the final response, and
  the effective URL is reported.
- **Compression:** `--compressed` means the body is decoded while the
  `content-encoding` header still reflects the wire form.
- **Timeout:** curl exits 28; the transport surfaces it as
  `curl-impersonate exited with 28: â€¦`.

## Not covered

- Proxy configuration (the `Transport` interface has no proxy option yet)
- HTTP/3 (the build supports it; the wrapper does not force it)
- Long-lived pooling or connection reuse across requests
- **Only `win32-x64` was executed here.** The other platform hashes are GitHub's
  published digests, pinned but not run on this machine.
