# Spike S3 — Chromium cost (`patchright`)

Is the dynamic path too heavy to use by default? **No — it is cheaper than assumed.**

| Metric | Measured |
|---|---|
| Cold launch | 166 ms |
| Warm navigation (echo endpoint) | 542 ms median |
| `example.com` `domcontentloaded` | 160 ms |
| RSS delta | ≈102 MB (2885 → 2987 MB) |
| Fingerprint | `ja4 t13d1516h2_8daaf6152771_806a8c22fdea`, Akamai `52d84b11…` |

The earlier assumption in [02](../../docs/02-transport-tls.md) was 100–400 MB and 50–150 ms per
request. Measured cost is at the *bottom* of that range, and the 542 ms echo-endpoint figure is WAN
round-trip, not browser work — `example.com` at 160 ms is the representative number.

The fingerprint is the same Akamai hash as real Chrome and `curl_cffi`. Chromium's real cost is
memory and launch, not per-request time.

---

## Run

```powershell
npm init -y
npm install patchright
npx patchright install chromium
node measure.mjs
```

---

## Gotchas

1. **`browser.process()` does not exist** in patchright — there is no public browser PID. RSS is
   therefore measured as a **system-wide delta** across `chrome.exe` / headless-shell processes, so
   the delta is only as clean as the machine. Close other browsers for a precise figure.
2. **A failed run leaks a browser.** Clean up with a command-line filter scoped to browser
   executables — filtering on `*ms-playwright*` alone will match (and kill) your own PowerShell.
3. **`npx patchright install chromium` fetches the headless shell** (~118 MB), which is what
   `headless: true` uses.
4. First navigation to the echo endpoint was 3355 ms; subsequent 532/542 ms. Treat the first as
   warm-up.

## Files

| File | Role |
|---|---|
| `measure.mjs` | launch, 3 navigations, fingerprint, RSS delta, real-page timing |
| `rss.ps1` | sums working set of all browser processes |
