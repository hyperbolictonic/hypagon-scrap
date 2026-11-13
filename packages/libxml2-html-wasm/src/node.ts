import type { HtmlDocument } from "./document.js";
import type { Ptr } from "./types.js";
import { NODE_DOCUMENT, NODE_ELEMENT, NODE_TYPE_NAMES } from "./types.js";
import type { RawApi } from "./wasm.js";
import { takeString } from "./wasm.js";

/**
 * A handle on one node inside an {@link HtmlDocument}.
 *
 * Handles are cheap wrappers around a WASM pointer: they are not cached, not
 * identity-stable (`a.children[0] !== a.children[0]`), and become invalid the
 * moment their document is disposed.
 */
export class HtmlNode {
  readonly #doc: HtmlDocument;
  readonly #ptr: Ptr;

  constructor(doc: HtmlDocument, ptr: Ptr) {
    this.#doc = doc;
    this.#ptr = ptr;
  }

  /** Raw pointer. Internal — used by the relocation layer, not by consumers. */
  get pointer(): Ptr {
    return this.#ptr;
  }

  #api(): RawApi {
    return this.#doc.requireApi();
  }

  /** libxml2 node type: 1 element, 3 text, 4 CDATA, 8 comment, 9 document. */
  get type(): number {
    return this.#api().type(this.#ptr);
  }

  get typeName(): string {
    return NODE_TYPE_NAMES[this.type] ?? "other";
  }

  get isElement(): boolean {
    return this.type === NODE_ELEMENT;
  }

  /** Tag name for elements; comment/CDATA marker otherwise. */
  get name(): string {
    return this.#api().utf8(this.#api().name(this.#ptr));
  }

  /** Deep text content — lxml's `text_content()`. */
  get text(): string {
    const api = this.#api();
    return takeString(api, api.text(this.#ptr));
  }

  /**
   * Own text only — lxml's `.text`. This is the value relocation scores on;
   * deep text would make every container look alike.
   */
  get ownText(): string {
    const api = this.#api();
    return takeString(api, api.ownText(this.#ptr));
  }

  /** Attributes as a plain object, in document order. */
  get attrs(): Record<string, string> {
    const api = this.#api();
    const out: Record<string, string> = {};
    const count = api.attrCount(this.#ptr);
    for (let i = 0; i < count; i++) {
      const name = api.utf8(api.attrName(this.#ptr, i));
      out[name] = takeString(api, api.attrValue(this.#ptr, i));
    }
    return out;
  }

  /** All child nodes, including text (and comments unless dropped). */
  get childNodes(): HtmlNode[] {
    const api = this.#api();
    const count = api.childCount(this.#ptr);
    const out: HtmlNode[] = [];
    for (let i = 0; i < count; i++) {
      const child = api.childAt(this.#ptr, i);
      if (child) out.push(new HtmlNode(this.#doc, child));
    }
    return out;
  }

  /** Element children only. */
  get children(): HtmlNode[] {
    return this.childNodes.filter((child) => child.isElement);
  }

  /** Parent element, or null at the root (the document node is not an element). */
  get parent(): HtmlNode | null {
    const api = this.#api();
    const parent = api.parent(this.#ptr);
    if (!parent || api.type(parent) === NODE_DOCUMENT) return null;
    return new HtmlNode(this.#doc, parent);
  }

  /** XPath string, same format as lxml's `getpath()`. */
  get path(): string {
    const api = this.#api();
    return takeString(api, api.path(this.#ptr));
  }

  /**
   * XPath evaluated with this node as the context node, like lxml's
   * `element.xpath()`. `//` still selects from the document root; `.//` is
   * relative to this node.
   */
  xpath(expr: string): HtmlNode[] {
    return this.#doc.evaluate((api) => api.xpathAt(this.#ptr, expr));
  }
}
