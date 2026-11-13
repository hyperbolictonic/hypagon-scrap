# hypagon-scrap

> **Experimental.** Pre-1.0: APIs may change without notice. Suitable for evaluation and internal
> use, not yet a stable dependency.
>
> *I Can't Believe It's Not Scrapling.*

A Node/TypeScript port of [Scrapling](https://github.com/d4vinci/Scrapling)'s parser and adaptive
relocation, built to be reusable as a standalone library and to harden the research component of
Hypagon Gateway.

The design goal is a **swiss army knife**: identical parsing and relocation everywhere, with the
transport swapped to suit the host — Electron's `net`, a vendored curl-impersonate binary, or a
real browser.

---

## Layout

```
docs/                 research and design record (start at docs/index.md)
  00-state.md         consolidated position, decisions, machine facts, landmines
  02-transport-tls.md fingerprinting, transports, GREASE
  03-parser-lxml.md   parser parity problem and the WASM decision
  04-adaptive-relocation.md  both relocation algorithms and scoring
  05-spikes.md        S1–S5 results
  06-architecture.md  interfaces and consumer mappings
  07-packaging.md     the WASM distribution gap
  08-implementation-plan.md  phased build plan and progress

packages/             the library
  libxml2-html-wasm/  libxml2 2.11.9 HTML + XPath in WASM, explicit document handles
  core/               Page/Selector, adaptive relocation, swappable transports

spikes/               reproducible experiments behind every decision
  libxml2-parity/     lxml comparison corpus
  libxml2-wasm/       first WASM build (single-document, superseded by the package)
  transport-fingerprint/  curl_cffi vs Node curl wrappers
  electron-net/       Electron `net` fingerprint probe
  electron-live/      core + transport + parser + relocation inside real Electron
  patchright-cost/    Chromium memory/latency cost
  relocation/         S5 port + Python reference harness
  css-parity/         CSS->XPath vs cssselect, compared by selected nodes
  text-parity/        get_all_text / find_by_text / find_by_regex vs Scrapling
  curl-binary/        pinned vendored binary + fingerprint parity
```

Rules of the house:

- **`packages/` is shipped code.** TypeScript in `src/`, tests in `test/`, generated artifacts in
  `build/` (gitignored).
- **`spikes/` is evidence.** Never imported by `packages/`; each spike documents how to reproduce
  its result.
- **`docs/` is the memory.** A finding that only exists in chat is a finding that will be lost.

---

## Build

Requires Node 20+ and (for the WASM artifact only) [emsdk](https://emscripten.org/) at `~/emsdk`.

```powershell
npm install
npm run build:wasm      # one-time / when the C wrapper changes
npm test
```

`build:wasm` fetches libxml2 2.11.9 into the package's `.cache/` and compiles it; no autotools, no
MSVC, no Python.

## Status

| Area | State |
|---|---|
| Research (S1–S5) | ✅ complete, documented |
| P0 scaffold | ✅ packages, workspaces, tsconfig |
| P1 parser package | ✅ 12/12 tests, 53/53 relocation parity re-confirmed |
| P2 selector + CSS | ✅ CSS 250/250, text 33/33 vs Scrapling; serialisation pending |
| P3 transport | ✅ Electron live (14/14) + binary JA4 parity; patchright pending |
| P4 relocation integration | ✅ in `packages/core`, 53/53 parity in CI |
| P5–P7 | ⬜ packaging, Hypagon integration, hardening |

Full plan: [docs/08-implementation-plan.md](docs/08-implementation-plan.md).

## Constraint that shaped everything

No MSVC, clang, gcc, cmake or make on the target machine. Every native-binary route is therefore
dead, which is why the parser is WASM and the transport is either a prebuilt binary or a host
facility.

## Credits

Portions of this project are derived from [Scrapling](https://github.com/d4vinci/Scrapling)
(BSD-3-Clause, Copyright © 2024 Karim shoair): the adaptive relocation algorithms, the element
fingerprint shape, and the selector/text API design. The `SequenceMatcher` port follows CPython's
`difflib` (Python Software Foundation licence). [libxml2](https://gitlab.gnome.org/GNOME/libxml2)
(MIT) is compiled to WebAssembly. [curl-impersonate](https://github.com/lexiforest/curl-impersonate)
(MIT) is downloaded and hash-verified, not bundled.

Full attribution and upstream licence texts: [NOTICE](NOTICE),
`packages/core/LICENSE_SCRAPLING.txt`, `packages/core/LICENSE_PSF.txt`,
`packages/libxml2-html-wasm/LICENSE_LIBXML2.txt`.
