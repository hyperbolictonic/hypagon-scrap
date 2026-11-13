/**
 * libxml2 2.11.9 HTML parser + XPath, compiled to WebAssembly.
 *
 * Public surface: {@link HtmlDocument}, {@link HtmlNode}, {@link parseHtml}.
 * See README.md for the ownership contract.
 */
export { HtmlDocument, parseHtml } from "./document.js";
export { HtmlNode } from "./node.js";
export type { ParseOptions } from "./types.js";
