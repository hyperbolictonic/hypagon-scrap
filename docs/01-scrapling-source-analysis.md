# 01 — Scrapling Source Analysis

[← Index](index.md)

What Scrapling actually is, measured from source rather than README claims.

---

## Repo scale

**699 files, 171 Python files.** But the value is concentrated in three:

| File | Size | Role |
|---|---|---|
| `scrapling/parser.py` | 58 KB | `Selector` / `Selectors` — 2 classes, ~45 public methods |
| `scrapling/engines/static.py` | 40 KB | curl_cffi wrapper (`FetcherSession`, `FetcherClient`, `AsyncFetcherClient`) |
| `scrapling/engines/_browsers/_stealth.py` | 39 KB | `StealthySession` / `AsyncStealthySession` |
| `scrapling/engines/toolbelt/ad_domains.py` | 95 KB | Ad/tracker blocklist — data, not logic |
| `scrapling/engines/toolbelt/convertor.py` | 23 KB | `ResponseFactory` — normalises curl/playwright responses |
| `scrapling/engines/toolbelt/fingerprints.py` | **4 KB** | header generation only |
| `scrapling/core/ai/server.py` | 57 KB | MCP server for the AI features |

Directory layout:

```
scrapling/
  parser.py                  58 KB
  core/          8 files     _types, custom_types, mixins, storage, translator, utils, ai/
  engines/       3 files     static.py, _browsers/ (9), toolbelt/ (7)
  fetchers/      3 files
  spiders/      12 files     engine, templates/ (7)
  integrations/  2 files
```

---

## Critical finding: Scrapling implements no TLS

`static.py` contains **58 `impersonate` references and 19 `curl_cffi` references** — and not one
line of TLS logic. It forwards `impersonate="chrome"` to `curl_cffi` and lets
libcurl-impersonate do the work.

`fingerprints.py` is only **4 KB** and exposes just `get_os_name`, `driven_browser_version`,
`generate_headers` — it exists to keep *headers* consistent with the impersonated profile, not
to build fingerprints.

**Consequence:** the port question reduces to "does Node have a curl-impersonate equivalent?"
The answer is yes, several → [02-transport-tls.md](02-transport-tls.md).

Default impersonation: `"chrome"`. Accepted literal values observed: `chrome`, `firefox`, `edge`.
The parameter also accepts a **list**, from which one is chosen at random per request.

---

## Dependencies

```
lxml>=6.1.1 · cssselect · orjson · tld · w3lib · typing_extensions    (Python >=3.10)
```

| Python | Role | Node equivalent | Gap |
|---|---|---|---|
| `lxml` | HTML/XML parse + XPath | `libxmljs2` (real libxml2) | **Real** — see [03](03-parser-lxml.md) |
| `cssselect` | CSS → XPath | needs a port or library | Small |
| `orjson` | fast JSON | native `JSON` | None |
| `tld` | domain parsing | `tldts` 7.5.1 | None |
| `w3lib` | URL canonicalisation | native `URL` / `whatwg-url` | Small |

Fetch backends (separate installs): `curl_cffi` (static), `patchright` (stealth browser).
Note: stealth uses **`patchright`, not Camoufox** — a patched Playwright, which matters because
`patchright` ships for Node too.

---

## Problem inventory

| # | Problem | Evidence | Node verdict |
|---|---|---|---|
| 1 | TLS / JA3-JA4 + HTTP/2 impersonation | `static.py` → curl_cffi | Solved by ecosystem |
| 2 | **Adaptive relocation** | `adaptive` ×49, `similarity` ×10, `difflib`, `relocate()`, `find_similar()` | Portable — pure algorithm |
| 3 | Browser stealth | `_stealth.py` imports `patchright` | Solved: `patchright@1.64.3` |
| 4 | lxml selector semantics | `parser.py` 58 KB; `lxml.html`, `cssselect` | Open |
| 5 | Spiders framework | `spiders/` — 12 files, checkpoints, robots.txt | `crawlee@3.18.2` |
| 6 | Ad-domain blocking | `ad_domains.py` 95 KB | Data + matching, trivial |
| 7 | AI / MCP server | `core/ai/server.py` 57 KB | Out of scope initially |

---

## What "port" actually means here

Not a 171-file transliteration. Four layers, two of which are vendored:

```
API surface      → write
Relocation       → write (the value)
Parser           → decide (see 03)
Normalisation    → write (straightforward)
Transport        → vendor (see 02)
```
