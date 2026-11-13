# 06 — Architecture

[← Index](index.md)

Library shape for a **reusable** Node package that also hardens Hypagon Gateway's research
component.

---

## Design constraints

1. **Reusable** — usable standalone (CLI/library) and embedded in an Electron host
2. **Pluggable** — transport and scorer are choices, not assumptions
3. **No mandatory native build** — but native/WASM permitted behind an interface
4. **Deterministic by default** — semantic matching is opt-in so results stay reproducible

---

## Layers

```
┌──────────────────────────────────────────────┐
│ Public API (Selector / Selectors)            │  write
├──────────────────────────────────────────────┤
│ Adaptive relocation + fingerprint storage     │  write  ← the value
├──────────────────────────────────────────────┤
│ Parser adapters                              │  decide  ← see 03
├──────────────────────────────────────────────┤
│ Response normalisation                       │  write
├──────────────────────────────────────────────┤
│ Transport adapters                           │  vendor  ← see 02
└──────────────────────────────────────────────┘
```

---

## Interfaces

```ts
// ---- Transport -------------------------------------------------------------
interface Transport {
  fetch(req: RequestSpec): Promise<TransportResponse>;
  close(): Promise<void>;
}

// Peer implementations:
//   CurlImpersonateTransport   — vendored binary / napi binding
//   PlaywrightTransport        — patchright, dynamic path
//   ElectronNetTransport       — Chromium stack inside Electron
//   UndiciTransport            — plain, no fingerprinting (tests, trusted hosts)

// ---- Parser ----------------------------------------------------------------
interface ParserAdapter {
  parse(html: string | Buffer, opts?: ParseOptions): DocumentTree;
  selectXPath(tree: DocumentTree, expr: string): Node[];
  selectCss(tree: DocumentTree, expr: string): Node[];   // via CSS→XPath
  pathOf(node: Node): string;                            // MUST match lxml format
}

// Peer implementations:
//   Libxml2WasmAdapter     — custom emscripten build  ← DEFAULT (S1b: 100% parity)
//   Libxml2NativeAdapter   — libxmljs2                 ← rejected: 93%, pinned 2.9.9
//   Parse5Adapter          — approximation, documented divergences
//   LxmlSidecarAdapter     — Python lxml over IPC, perfect parity

// ---- Scorer ----------------------------------------------------------------
interface Scorer {
  score(fp: Fingerprint, candidate: Node): number;   // 0..100
}
//   StructuralScorer — ported __calculate_similarity_score (default)
//   EmbeddingScorer  — cosine similarity, opt-in
```

`pathOf` is deliberately part of the parser interface: relocation scores depend on lxml-compatible
path strings, so a parser that cannot produce them must be treated as lossy. See
[04](04-adaptive-relocation.md).

---

## Consumer mappings

| Consumer | Transport | Parser | Scorer |
|---|---|---|---|
| Standalone Node library/CLI | **Vendored lexiforest binary (pinned) + wrapper** | **WASM libxml2 2.11.9** | structural |
| **Hypagon Gateway** (Electron) | **Electron `net`** (S4 passed — genuine Chromium fingerprint) | **WASM libxml2 2.11.9** | structural **or** embedding (`onnxruntime` already bundled) |
| Linux server | `curl-cffi-node` (in-process) | **WASM libxml2 2.11.9** | structural |
| Browser/edge runtime | n/a | WASM libxml2 (same artifact) | structural |
| Maximum-fidelity / debug | `curl_cffi` sidecar | Python `lxml` sidecar | structural |

---

## Why this helps Hypagon's research component specifically

Hypagon is **Electron + LanceDB + `onnxruntime-node`** — a local RAG pipeline. The gaps a research
component usually has are:

| Gap | Fix from this library |
|---|---|
| Pages that block plain fetches | Chromium/`net` transport with a real fingerprint |
| JS-rendered content missing from retrieval | dynamic transport path |
| Extracted markup drifting as sites change | adaptive relocation + fingerprints |
| Fragile hand-written selectors | relocation instead of brittle CSS |
| Content fetched but poorly parsed | real libxml2 rather than an approximation |

Two things make this unusually cheap for Hypagon: `onnxruntime-node` already exists (so the
embedding scorer is free infrastructure), and Electron already contains Chromium (so a genuine
fingerprint may need no new binary at all).

---

## Non-goals (initially)

- Spiders / crawling engine — use `crawlee` if needed
- AI/MCP server surface (`core/ai/server.py`)
- Ad-domain blocklist (`ad_domains.py`) — data, port later
- Byte-for-byte API compatibility with Scrapling

---

## Risks

| Risk | Mitigation |
|---|---|
| Native-addon ABI churn lags Node releases | ✅ resolved — WASM parser has no per-ABI build |
| WASM memory leaks in long-lived processes | explicit `free()` / arena per document; see [07](07-packaging.md) |
| Vendored TLS binary supply chain | pin + verify sha256 (cuimp does **not** verify); or Electron `net` |
| Relocation fidelity drifts from parser choice | validate parser and relocation on one corpus |
| Chromium memory on 8–16 GB machines | ≈102 MB measured (S3), not the feared 400 MB; still reuse one instance |
