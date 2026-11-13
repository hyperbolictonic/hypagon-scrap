# hypagon-scrap

> **Experimental.** Pre-1.0; the API may change without notice. Portions are derived from Scrapling
> (BSD-3-Clause) — see [NOTICE](NOTICE) and `LICENSE_SCRAPLING.txt`.

Selection and adaptive relocation on top of the WASM libxml2 parser, with a
swappable transport layer.

The point of the split: **parsing and relocation are identical everywhere**;
only the HTTP transport changes with the host.

```
Electron main  ->  ElectronNetTransport   (Chromium fingerprint, no binary)
Plain Node     ->  curl-impersonate binary (not built yet)
Tests / local  ->  FetchTransport         (not stealthy)
```

## Use

```js
import { Page } from "hypagon-scrap";

const page = await Page.load("<div class='card'><h2>Widget</h2></div>");
try {
  const [card] = page.xpath("//div[@class='card']");

  // Save a fingerprint (plain JSON â€” survives a database round-trip).
  const fingerprint = card.fingerprint();

  // Later, after the site's markup changes:
  const changed = await Page.load(newHtml);
  const [relocated] = changed.relocate(fingerprint);   // threshold 40 by default
  console.log(relocated?.path);
} finally {
  page.dispose();
}
```

Disposal matters: `Page` owns a WASM document, and selectors hold nodes from it.
`await using page = await Page.load(html)` works too.

## Transports

| Transport | Where | Fingerprint |
|---|---|---|
| `ElectronNetTransport` | Electron main process | Chromium (version tracks Electron) |
| `CurlImpersonateTransport` | any Node | pinned Chrome profile â€” **JA4 matches `curl_cffi` exactly** |
| `FetchTransport` | any Node | **none** â€” Node's TLS stack; local/internal use only |

`createElectronNetTransport()` dynamically imports Electron and fails with an
explanation outside it, so a plain Node install never loads Electron.

```js
import { createElectronNetTransport, Page } from "hypagon-scrap";

const transport = await createElectronNetTransport();   // Electron main only
const response = await transport.request({ url: "https://example.com" });
const page = await Page.load(new TextDecoder().decode(response.body));
```

`ElectronNetTransport` is also constructible with any structurally compatible
`net` object, which is how its tests run without Electron.

### Binary transport (plain Node)

The non-Electron route is a pinned
[curl-impersonate](https://github.com/lexiforest/curl-impersonate) build driven as
a subprocess. It reproduces the `curl_cffi` fingerprint exactly (chrome131 and
chrome152 JA4 + H2 settings).

```powershell
npm run fetch:curl -w hypagon-scrap   # verifies SHA-256 before installing
```

```js
import { CurlImpersonateTransport, Page } from "hypagon-scrap";

const transport = new CurlImpersonateTransport({ profile: "chrome152" });
const response = await transport.request({ url: "https://example.com" });
const page = await Page.load(new TextDecoder().decode(response.body));
```

Supply chain: version `2.3.2` and per-platform hashes are constants in
`scripts/fetch-curl-impersonate.mjs`, taken from GitHub's published asset digests
(win32-x64 independently reproduced). There is no postinstall hook and no
unverified execution; a mismatch deletes the download.

Notes: one process per request; `--impersonate chrome` is not a valid target
(profiles are explicit); the build has `NativeCA`, so Windows HTTPS works without
a CA bundle, and `caBundle` maps to `--cacert` when one is required.

## CSS

`page.css(...)` and `selector.css(...)` translate CSS to XPath and evaluate from
the root element â€” the same context Scrapling uses. Validated against
`cssselect` 1.6.0 by **selected nodes**: 250/250 (50 selectors Ã— 5 documents).

Supported: type/universal, `.class`, `#id`, attribute selectors (`[a]`, `=`,
`~=`, `|=`, `^=`, `$=`, `*=`, `!=`, with `i`/`s` flags), combinators (space,
`>`, `+`, `~`), groups, `:not()`, `:root`, `:empty`, `:first/last/only-child`,
`:first/last/only-of-type`, the four `:nth-*` forms, `:checked`, `:link`,
`:contains()`, `:lang()`, the never-matching interaction pseudos, and
`::text` / `::attr(name)`.

Anything else throws `CssSelectorError` rather than silently selecting something
different: namespace prefixes, escaped identifiers, `:disabled`, `:enabled`,
`:is()`, `:where()`, `:has()`, and other pseudo-elements.

## Text

`selector.text` is lxml's **own** text â€” the text before the first child element â€”
not the subtree. That matches Scrapling and matters because `findByText` and
relocation fingerprints both depend on it. Use `getAllText()` for the deep walk.

```js
const [article] = page.css("article.product");

article.text;                    // own text only
article.getAllText();            // deep text, script/style skipped
article.getAllText({ separator: " ", strip: true });
article.findByText("Widget");    // exact, own text, whitespace-collapsed
article.findByRegex(/\d+\.\d+/);
article.hasClass("product");
```

| Option | Default | Notes |
|---|---|---|
| `getAllText.separator` | `"\n"` | joins collected text nodes |
| `getAllText.ignoreTags` | `["script","style"]` | whole subtrees skipped |
| `getAllText.validValues` | `true` | drops empty/whitespace-only strings |
| `findByText.firstMatch` | `true` | Scrapling's default |
| `findByText.partial` | `false` | substring instead of equality |
| `findByText.cleanMatch` | `true` | collapses whitespace **in the element text, not the query** |

Validated against Scrapling: **33/33** operations, compared as exact strings.

Text extraction deliberately stops here. Markdown conversion and context
budgeting belong in the consumer â€” the library should not impose a second,
competing document format.

## Relocation

Two algorithms, both ported and validated against Scrapling 0.5.1:

- `selector.relocate(fingerprint, percentage)` â€” scores every element in the
  document, returns all elements tied at the best score, rejects below
  `percentage` (default 40).
- `selector.findSimilar({ threshold, ignoreAttributes, matchText })` â€” finds
  structural siblings (same depth, tag, parent tag, grandparent tag) with
  similar attributes.

`TreeIndex` is built lazily once per page and reused, so repeated relocations do
not re-walk the DOM.

Parity is enforced by `test/relocation-parity.test.js`, which replays 53 cases
(9 curated, 40 seeded fuzz, 4 autojunk boundary) and compares the **entire score
table**, not just the winning element. Goldens were generated by
`spikes/relocation/py-ref.py`.

## Layout

```
packages/core/
  src/
    page.ts              Page: document + cached index + dispose
    selector.ts          Selector: node + selection + relocation
    css/
      index.ts           CSS -> XPath translator + parser
    text/
      index.ts           get_all_text, find_by_text, find_by_regex, cleaning
    relocation/
      difflib.ts         difflib.SequenceMatcher port + pyRound2
      index.ts           TreeIndex, fingerprint, scoring, relocate, findSimilar
    transport/
      types.ts           Transport interface
      electron.ts        Electron net
      curl-impersonate.ts pinned binary subprocess transport
      fetch.ts           plain fetch (non-stealthy)
    index.ts             public exports
  scripts/
    fetch-curl-impersonate.mjs  pinned download + SHA-256 verification
  test/
    difflib.test.js
    css.test.js
    text.test.js
    relocation-parity.test.js
    transport.test.js
    vertical-slice.test.js
    fixtures/            corpora + Scrapling-generated goldens
```

## Not here yet

- patchright/browser transport
- proxy support in the `Transport` interface
- `html_content` / `prettify` (serialisation)
- `:disabled` / `:enabled` / `:is()` / `:where()` / `:has()`
