# Spike S1b — libxml2 2.11.9 HTML parser in WASM

Closes the parser-parity gap found in S1. `libxmljs2` is pinned to libxml2 **2.9.9** and diverges on
7% of the corpus; building the exact engine `lxml` 6.1.3 uses (**2.11.9**) to WASM gives **15/15**.

| Artifact | Size |
|---|---|
| `build/hx.wasm` | 466.6 KB |
| `build/hx.mjs` | 58.7 KB |

Everything the harness needs is prebuilt in `build/` — rebuilding is only necessary to change the
wrapper or the libxml2 version.

---

## Rebuild

```powershell
# one-time: toolchain (~714 MiB download, ~2.1 GB on disk)
git clone --depth 1 https://github.com/emscripten-core/emsdk.git $env:USERPROFILE\emsdk
$env:USERPROFILE\emsdk\emsdk.bat install latest
$env:USERPROFILE\emsdk\emsdk.bat activate latest

# one-time: source (2.5 MB)
Invoke-WebRequest https://download.gnome.org/sources/libxml2/2.11/libxml2-2.11.9.tar.xz -OutFile libxml2-2.11.9.tar.xz
tar -xf libxml2-2.11.9.tar.xz

# every build
powershell -ExecutionPolicy Bypass -File build.ps1
```

POSIX: `./build.sh` (sources `emsdk_env.sh`; unverified on Windows — `build.ps1` is the tested path).

---

## Verify parity

```powershell
node wasm-side.mjs out-wasm.json
node ..\libxml2-parity\compare.js out-wasm.json ..\libxml2-parity\out-python.json
# => { "summary": { "total": 15, "pass": 15, "fail": 0, "passRate": "100%" } }
```

`out-python.json` is produced by `..\libxml2-parity\py-side.py` against `lxml` 6.1.3.

---

## Layout

| File | Role |
|---|---|
| `src/hx_wrapper.c` | C surface: parse, tree walk, attrs, `xmlGetNodePath`, XPath |
| `gen-headers.js` | generates `xmlversion.h` (configure's job) + `config.h` |
| `build.ps1` / `build.sh` | compiles 40 libxml2 TUs + the wrapper in one `emcc` call |
| `wasm-side.mjs` | harness adapter — emits the same JSON as the other runners |
| `libxml2-2.11.9/` | upstream source (not vendored deliberately; fetched, not committed) |

---

## Landmines

These cost real debugging time and will recur in the production port:

1. **Never `xmlFree` interned names.** `node->name` / attribute names point into the document
   dictionary. Freeing them does not crash — it silently corrupts the dictionary, after which
   **XPath returns zero results** and tag names come back as mojibake.
2. **Walk from the root element, not the doc.** `lxml`'s `document_fromstring` returns `<html>` and
   callers iterate its children, so the first emitted node is `<body>`. Starting at `xmlDoc` adds a
   level and shifts every depth.
3. **Encoding is not optional.** libxml2 defaults charset-less HTML to ISO-8859-1; `lxml` effectively
   passes UTF-8. `hx_parse` takes an explicit encoding because omitting it mojibakes CJK.
4. **`xmlversion.h` and `config.h` are configure outputs.** `libxml.h` includes `config.h`
   unconditionally; neither ships in the tarball.
5. **Exclude standalone drivers.** `nanoftp.c`, `runsuite.c`, `runxmlconf.c` define `main()`.

---

## Known limits

- One document at a time (`last_doc` static) — fine for a spike, wrong for a library
- No CSS selectors (libxml2 has none); needs a `cssselect` layer
- `ENVIRONMENT=node` only
- No performance measurement yet
- 15 cases is a smoke test; the structural argument is the identical engine version
