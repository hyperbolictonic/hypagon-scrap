import { HtmlDocument } from "hypagon-scrap-libxml2";
import type { ParseOptions } from "hypagon-scrap-libxml2";

import { cssToXpath } from "./css/index.js";
import { TreeIndex, relocate } from "./relocation/index.js";
import type { Fingerprint } from "./relocation/index.js";
import { Selector } from "./selector.js";

/**
 * A parsed document plus its cached tree index.
 *
 * The index is built lazily and reused by every relocation and find-similar
 * call on this page, so repeated queries do not re-walk the tree.
 */
export class Page {
  readonly document: HtmlDocument;
  #index: TreeIndex | null = null;

  private constructor(document: HtmlDocument) {
    this.document = document;
  }

  static async load(html: string, options?: ParseOptions): Promise<Page> {
    return new Page(await HtmlDocument.parse(html, options));
  }

  get index(): TreeIndex {
    if (this.#index === null) this.#index = new TreeIndex(this.document);
    return this.#index;
  }

  xpath(expression: string): Selector[] {
    return this.document.xpath(expression).map((node) => new Selector(this, node));
  }

  /**
   * CSS selection, translated to XPath and evaluated from the root element —
   * the same context Scrapling uses (`self._root.xpath(...)`).
   */
  css(selector: string): Selector[] {
    const root = this.document.root;
    if (!root) return [];
    return root.xpath(cssToXpath(selector)).map((node) => new Selector(this, node));
  }

  get root(): Selector | null {
    const node = this.document.root;
    return node ? new Selector(this, node) : null;
  }

  /** Adaptive relocation against this page's tree. */
  relocate(fingerprint: Fingerprint, percentage = 40): Selector[] {
    const index = this.index;
    return relocate(index, fingerprint, percentage).indices.map(
      (i) => new Selector(this, index.node(i)),
    );
  }

  dispose(): void {
    this.document.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
