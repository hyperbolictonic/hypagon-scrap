import { HtmlNode } from "./node.js";
import type { ParseOptions, Ptr } from "./types.js";
import { loadApi } from "./wasm.js";
import type { RawApi } from "./wasm.js";

/**
 * Safety net for documents that were collected without `dispose()`.
 * Explicit disposal is the primary path; this only prevents leaks in code that
 * forgets, and it is not deterministic.
 */
const finalizer = new FinalizationRegistry<{ api: RawApi; ptr: Ptr }>((held) => {
  held.api.docFree(held.ptr);
});

/**
 * One parsed HTML document.
 *
 * Ownership is explicit and scoped: every node handle belongs to this document,
 * and `dispose()` frees the whole tree. There is no module-level "current
 * document", so any number of documents can be alive at once.
 */
export class HtmlDocument {
  readonly #api: RawApi;
  readonly #ptr: Ptr;
  #disposed = false;

  private constructor(api: RawApi, ptr: Ptr) {
    this.#api = api;
    this.#ptr = ptr;
  }

  /**
   * Parses HTML with the same flags Scrapling uses: recover, remove blank text,
   * huge tree, UTF-8. Comments are dropped unless `dropComments: false`.
   */
  static async parse(html: string, opts: ParseOptions = {}): Promise<HtmlDocument> {
    const api = await loadApi();
    // Scrapling strips the input before parsing; mirror it so tree shape matches.
    const body = html.trim() || "<html/>";
    const ptr = api.parse(body, api.byteLength(body), opts.encoding ?? "UTF-8");
    if (!ptr) throw new Error("libxml2 failed to parse the document");

    if (opts.dropComments !== false) api.dropComments(ptr);

    const doc = new HtmlDocument(api, ptr);
    finalizer.register(doc, { api, ptr }, doc);
    return doc;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** @internal — called by {@link HtmlNode} to keep the handle honest. */
  requireApi(): RawApi {
    if (this.#disposed) throw new Error("HtmlDocument has been disposed");
    return this.#api;
  }

  /** @internal — shared XPath result collection. */
  evaluate(run: (api: RawApi) => Ptr): HtmlNode[] {
    const api = this.requireApi();
    const result = run(api);
    if (!result) return [];
    try {
      const size = api.xpathSize(result);
      const nodes: HtmlNode[] = [];
      for (let i = 0; i < size; i++) {
        const ptr = api.xpathItem(result, i);
        if (ptr) nodes.push(new HtmlNode(this, ptr));
      }
      return nodes;
    } finally {
      api.xpathFree(result);
    }
  }

  get root(): HtmlNode | null {
    const api = this.requireApi();
    const ptr = api.root(this.#ptr);
    return ptr ? new HtmlNode(this, ptr) : null;
  }

  /** XPath evaluated against the document root. */
  xpath(expr: string): HtmlNode[] {
    return this.evaluate((api) => api.xpath(this.#ptr, expr));
  }

  /** Frees the tree. Node handles from this document must not be used afterwards. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    finalizer.unregister(this);
    this.#api.docFree(this.#ptr);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** Convenience alias for {@link HtmlDocument.parse}. */
export function parseHtml(html: string, opts?: ParseOptions): Promise<HtmlDocument> {
  return HtmlDocument.parse(html, opts);
}
