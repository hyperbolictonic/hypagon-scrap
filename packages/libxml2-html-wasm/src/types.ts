/** Opaque WASM pointer. Never dereference, never persist beyond a document's life. */
export type Ptr = number;

export interface ParseOptions {
  /**
   * Input encoding. Defaults to UTF-8, which is what lxml receives for `str`
   * input. Passing `null`-ish would let libxml2 guess and fall back to
   * ISO-8859-1 for charset-less HTML.
   */
  encoding?: string;

  /**
   * Remove comment nodes after parsing, mirroring Scrapling's
   * `remove_comments=True` (its default). Set false to keep them.
   */
  dropComments?: boolean;
}

export const NODE_ELEMENT = 1;
export const NODE_TEXT = 3;
export const NODE_CDATA = 4;
export const NODE_COMMENT = 8;
export const NODE_DOCUMENT = 9;

export const NODE_TYPE_NAMES: Readonly<Record<number, string>> = {
  [NODE_ELEMENT]: "element",
  [NODE_TEXT]: "text",
  [NODE_CDATA]: "cdata",
  [NODE_COMMENT]: "comment",
  [NODE_DOCUMENT]: "document",
};
