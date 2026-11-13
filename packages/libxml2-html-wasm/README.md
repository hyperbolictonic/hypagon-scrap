# hypagon-scrap-libxml2

> **Experimental.** Pre-1.0; the API may change without notice. Bundles libxml2 (MIT) — see
> [NOTICE](NOTICE) and `LICENSE_LIBXML2.txt`.

libxml2 **2.11.9** with HTML and XPath support, compiled to WebAssembly, exposed
with explicit document ownership.

This exists because Node has no maintained binding to a modern libxml2: `libxmljs2`
is pinned to 2.9.9 (which parses `<script>` contents differently) and needs native
builds that fail on current Node. The WASM build has no ABI, no compiler, and no
toolchain on the consumer machine.

## Layout

```
packages/libxml2-html-wasm/
  src/
    wrapper.c      C surface over libxml2 (the only C in this package)
    types.ts       shared types and node-type constants
    wasm.ts        module loading + the raw cwrap table
    node.ts        HtmlNode
    document.ts    HtmlDocument, disposal, finalizer
    index.ts       public exports
  test/            plain ESM tests, run against the built dist/
  scripts/
    build-wasm.ps1 compiles libxml2 + wrapper.c
    gen-headers.js generates the headers configure would produce
  build/           generated: hx.mjs, hx.wasm (gitignored)
  .cache/          generated: libxml2 source tree (gitignored)
```

`src/` is TypeScript and compiles to `dist/`. Tests are plain `.js` and import
`dist/`, so they exercise exactly what ships.

## Build

One-time, requires [emsdk](https://emscripten.org/) at `~/emsdk`:

```powershell
npm run build:wasm      # libxml2 + wrapper -> build/hx.mjs, build/hx.wasm
npm run build           # TypeScript -> dist/
npm test                # node --test against dist/
```

`build-wasm.ps1` fetches libxml2 2.11.9 into `.cache/` and generates
`xmlversion.h` / `config.h` itself â€” there is no autotools step.

## Use

```js
import { HtmlDocument } from "hypagon-scrap-libxml2";

const doc = await HtmlDocument.parse("<div id='x'>hello</div>");
try {
  const [div] = doc.xpath("//div[@id='x']");
  div.attrs;      // { id: "x" }
  div.ownText;    // "hello"  (lxml's .text)
  div.text;       // "hello"  (deep content)
  div.path;       // "/html/body/div"
} finally {
  doc.dispose();
}
```

`await using doc = await HtmlDocument.parse(html)` also works.

## Ownership

- `parse()` returns a document you own; call `dispose()` (or use `await using`).
- Node handles belong to that document and are invalid after disposal â€” access
  throws instead of reading freed memory.
- Multiple documents may be alive at once. There is no module-level "current
  document"; this is the specific bug that S5 exposed in the research spike.
- A `FinalizationRegistry` frees documents that were dropped without `dispose()`,
  but it is a safety net, not the contract.

## Behaviour notes

The parse flags mirror Scrapling, so relocation scores computed on this tree are
comparable with the Python reference:

| Setting | Effect |
|---|---|
| `HTML_PARSE_RECOVER` | malformed markup is repaired, not rejected |
| `HTML_PARSE_NOBLANKS` | mirrors Scrapling's `remove_blank_text`; in practice libxml2 keeps whitespace in HTML `.text`, exactly as lxml does |
| `XML_PARSE_HUGE` | no depth/size ceiling (`huge_tree`) |
| UTF-8 input | charset-less HTML is not misread as ISO-8859-1 |
| `dropComments` (default on) | comment nodes removed, like `remove_comments=True` |
| input `.trim()` | leading/trailing whitespace stripped before parsing |

`ownText` is the lxml `.text` semantics â€” text before the first child element.
Relocation depends on that distinction; deep text would make every container look
identical.

## Not here yet

- CSS selectors (planned for the core package, needs a CSSâ†’XPath layer)
- HTML serialisation / `prettify`
- Throughput benchmarks against `lxml`
