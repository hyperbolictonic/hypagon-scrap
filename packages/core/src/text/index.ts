/**
 * Text extraction and matching, ported from Scrapling's `Selector` methods and
 * `TextHandler`.
 *
 * The distinction that matters: an element's `.text` is its **own** text (lxml's
 * `element.text`), not its subtree content. `getAllText()` is the deep walk.
 */
import type { HtmlNode } from "hypagon-scrap-libxml2";

export interface GetAllTextOptions {
  /** Joins the collected strings. */
  separator?: string;
  /** Trim each string before joining. */
  strip?: boolean;
  /** Subtrees to skip entirely. */
  ignoreTags?: readonly string[];
  /** Drop strings that are empty or whitespace-only. */
  validValues?: boolean;
}

export interface FindByTextOptions {
  /** Return at most one element (Scrapling's default). */
  firstMatch?: boolean;
  /** Substring match instead of exact equality. */
  partial?: boolean;
  caseSensitive?: boolean;
  /**
   * Collapse whitespace in the element's text before matching.
   * Note: Scrapling cleans the element text, not the query.
   */
  cleanMatch?: boolean;
}

export interface FindByRegexOptions {
  firstMatch?: boolean;
  caseSensitive?: boolean;
  /** Collapse whitespace in the element's text before matching. */
  cleanMatch?: boolean;
}

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
const NODE_CDATA = 4;

/**
 * Python's `clean_spaces`: tabs to spaces, drop newlines, collapse runs.
 * No trimming — `TextHandler.clean()` trims separately.
 */
export function cleanSpaces(value: string): string {
  return value.replace(/\t/g, " ").replace(/[\n\r]/g, "").replace(/ +/g, " ");
}

/** `TextHandler.clean()`: clean_spaces + strip. */
export function cleanText(value: string): string {
  return cleanSpaces(value).trim();
}

const hasContent = (value: string): boolean => /\S/.test(value);

function descendantElements(node: HtmlNode): HtmlNode[] {
  const out: HtmlNode[] = [];
  const stack: HtmlNode[] = [];

  const children = node.children;
  for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);

  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    const kids = current.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }

  return out;
}

/**
 * All descendant text, joined — Scrapling's `get_all_text`.
 *
 * Text nodes are visited in document order. Ignored subtrees are skipped whole,
 * which is equivalent to lxml's ignore-set construction (it tracks the owning
 * element, including for tail text).
 */
export function getAllText(node: HtmlNode, options: GetAllTextOptions = {}): string {
  const {
    separator = "\n",
    strip = false,
    ignoreTags = ["script", "style"],
    validValues = true,
  } = options;

  if (!node.isElement) return node.text;

  const ignored = new Set(ignoreTags.map((tag) => tag.toLowerCase()));
  if (ignored.has(node.name)) return "";

  const parts: string[] = [];

  const walk = (current: HtmlNode): void => {
    for (const child of current.childNodes) {
      if (child.type === NODE_TEXT || child.type === NODE_CDATA) {
        const value = child.text;
        if (!value) continue;
        const processed = strip ? value.trim() : value;
        if (!validValues || processed.trim()) parts.push(processed);
      } else if (child.type === NODE_ELEMENT) {
        if (ignored.has(child.name)) continue;
        walk(child);
      }
    }
  };

  walk(node);
  return parts.join(separator);
}

/**
 * Find descendants whose **own** text matches.
 *
 * Scrapling's candidate set is `.//*[normalize-space(text())]`, so elements
 * without their own text are never considered — a text node in a tail position
 * does not make its container a match.
 */
export function findByText(
  node: HtmlNode,
  text: string,
  options: FindByTextOptions = {},
): HtmlNode[] {
  const {
    firstMatch = true,
    partial = false,
    caseSensitive = false,
    cleanMatch = true,
  } = options;

  if (!node.isElement) return [];

  const query = caseSensitive ? text : text.toLowerCase();
  const results: HtmlNode[] = [];

  for (const candidate of descendantElements(node)) {
    const own = candidate.ownText;
    if (!hasContent(own)) continue;

    let value = cleanMatch ? cleanText(own) : own;
    if (!caseSensitive) value = value.toLowerCase();

    const matched = partial ? value.includes(query) : value === query;
    if (matched) {
      results.push(candidate);
      if (firstMatch) break;
    }
  }

  return results;
}

/** Find descendants whose own text matches a regex. */
export function findByRegex(
  node: HtmlNode,
  query: string | RegExp,
  options: FindByRegexOptions = {},
): HtmlNode[] {
  const { firstMatch = true, caseSensitive = false, cleanMatch = true } = options;

  if (!node.isElement) return [];

  const pattern =
    typeof query === "string"
      ? new RegExp(query, caseSensitive ? "u" : "iu")
      : query;

  const results: HtmlNode[] = [];

  for (const candidate of descendantElements(node)) {
    const own = candidate.ownText;
    if (!hasContent(own)) continue;

    const input = cleanMatch ? cleanText(own) : own;
    pattern.lastIndex = 0; // a /g pattern would otherwise be stateful
    if (pattern.test(input)) {
      results.push(candidate);
      if (firstMatch) break;
    }
  }

  return results;
}
