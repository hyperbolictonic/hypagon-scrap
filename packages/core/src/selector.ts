import type { HtmlNode } from "hypagon-scrap-libxml2";

import type { Page } from "./page.js";
import { cssToXpath } from "./css/index.js";
import { findSimilar } from "./relocation/index.js";
import type { Fingerprint, FindSimilarOptions } from "./relocation/index.js";
import { findByRegex, findByText, getAllText } from "./text/index.js";
import type {
  FindByRegexOptions,
  FindByTextOptions,
  GetAllTextOptions,
} from "./text/index.js";

/**
 * A node plus the page it came from.
 *
 * Selectors are cheap and not identity-stable: `page.xpath("//p")[0]` twice
 * yields two objects wrapping the same node.
 */
export class Selector {
  readonly page: Page;
  readonly node: HtmlNode;

  constructor(page: Page, node: HtmlNode) {
    this.page = page;
    this.node = node;
  }

  get tag(): string {
    return this.node.name;
  }

  get attrs(): Record<string, string> {
    return this.node.attrs;
  }

  /**
   * The element's **own** text (lxml's `.text`), matching Scrapling.
   * For a text or attribute node, this is the node's value.
   * Use {@link getAllText} for the subtree.
   */
  get text(): string {
    return this.node.isElement ? this.node.ownText : this.node.text;
  }

  /** Own text only, as lxml's `.text`. */
  get ownText(): string {
    return this.node.ownText;
  }

  /** Deep text, joined — Scrapling's `get_all_text()`. */
  getAllText(options?: GetAllTextOptions): string {
    return getAllText(this.node, options);
  }

  /** Descendants whose own text matches. */
  findByText(text: string, options?: FindByTextOptions): Selector[] {
    return findByText(this.node, text, options).map(
      (node) => new Selector(this.page, node),
    );
  }

  /** Descendants whose own text matches a regex. */
  findByRegex(query: string | RegExp, options?: FindByRegexOptions): Selector[] {
    return findByRegex(this.node, query, options).map(
      (node) => new Selector(this.page, node),
    );
  }

  /** lxml's `element.classes` membership test. */
  hasClass(name: string): boolean {
    const classes = this.node.attrs.class;
    return classes ? classes.split(/\s+/).includes(name) : false;
  }

  /** XPath string, same shape as lxml's `getpath()`. */
  get path(): string {
    return this.node.path;
  }

  get parent(): Selector | null {
    const parent = this.node.parent;
    return parent ? new Selector(this.page, parent) : null;
  }

  xpath(expression: string): Selector[] {
    return this.node.xpath(expression).map((node) => new Selector(this.page, node));
  }

  /** CSS selection relative to this node. Empty for non-element nodes. */
  css(selector: string): Selector[] {
    if (!this.node.isElement) return [];
    return this.node.xpath(cssToXpath(selector)).map((node) => new Selector(this.page, node));
  }

  /** Snapshot used later to relocate this element in a changed document. */
  fingerprint(): Fingerprint {
    const index = this.page.index;
    return index.fingerprint(index.indexOf(this.node));
  }

  /**
   * Relocates a previously saved element in this page's tree.
   *
   * Pass the fingerprint (survives serialisation) or another Selector.
   */
  relocate(target: Fingerprint | Selector, percentage = 40): Selector[] {
    const fingerprint = target instanceof Selector ? target.fingerprint() : target;
    return this.page.relocate(fingerprint, percentage);
  }

  /** Structural siblings that resemble this element. */
  findSimilar(options?: FindSimilarOptions): Selector[] {
    const index = this.page.index;
    return findSimilar(index, index.indexOf(this.node), options).map(
      (i) => new Selector(this.page, index.node(i)),
    );
  }
}
