/**
 * Port of Scrapling's adaptive relocation, over the WASM libxml2 tree.
 *
 * Mirrors `scrapling/parser.py`:
 *   `_StorageTools.element_to_dict`  -> {@link TreeIndex.fingerprint}
 *   `__calculate_similarity_score`   -> {@link similarityScore}
 *   `__calculate_dict_diff`          -> {@link dictDiff}
 *   `relocate`                       -> {@link relocate}
 *   `__are_alike` / `find_similar`   -> {@link findSimilar}
 *
 * Validated against Scrapling 0.5.1 on 53 cases, comparing the whole score
 * table rather than only the winning element.
 */
import type { HtmlDocument, HtmlNode } from "hypagon-scrap-libxml2";

import { pyRound2, ratio } from "./difflib.js";
import { cleanSpaces } from "../text/index.js";

export interface Fingerprint {
  tag: string;
  attributes: Record<string, string>;
  text: string | null;
  path: string[];
  parent_name?: string;
  parent_attribs?: Record<string, string>;
  parent_text?: string | null;
  siblings?: string[];
  children?: string[];
}

export interface FindSimilarOptions {
  /** Minimum similarity, compared after Python-style rounding to 2 dp. */
  threshold?: number;
  /** Attributes ignored when comparing (Scrapling defaults to href/src). */
  ignoreAttributes?: readonly string[];
  /** Also compare own text. */
  matchText?: boolean;
}

export interface RelocateResult {
  /** Indices into the tree index, in document order. */
  indices: number[];
  /** Highest score seen, or null for an empty document. */
  top: number | null;
}

export interface IndexEntry {
  node: HtmlNode;
  tag: string;
  attrs: Record<string, string>;
  ownText: string;
  parent: number;
  depth: number;
  children: number[];
}

const ATTRIBUTE_FEATURES = ["class", "id", "href", "src"] as const;

function cleanAttributes(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value && value.trim()) out[name] = value.trim();
  }
  return out;
}

function attrsWithout(
  attrs: Record<string, string>,
  ignore: readonly string[],
): Record<string, string> {
  if (ignore.length === 0) return attrs;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!ignore.includes(name)) out[name] = value;
  }
  return out;
}

/** Python's clean_spaces: tabs to spaces, drop newlines, collapse runs. */
/**
 * A flat, document-order view of the tree.
 *
 * Built once per document instead of re-walking per candidate. Index 0 is the
 * root element; entries 1..n are exactly the `//*` descendants Scrapling scans.
 */
export class TreeIndex {
  readonly entries: IndexEntry[] = [];
  readonly #byPointer = new Map<number, number>();

  constructor(document: HtmlDocument) {
    const root = document.root;
    if (!root) return;

    // Iterative pre-order: deep pages would blow the call stack recursively.
    const stack: Array<{ node: HtmlNode; parent: number }> = [{ node: root, parent: -1 }];
    while (stack.length > 0) {
      const { node, parent } = stack.pop()!;
      const index = this.entries.length;

      this.entries.push({
        node,
        tag: node.name,
        attrs: node.attrs,
        ownText: node.ownText,
        parent,
        depth: parent === -1 ? 0 : this.entries[parent]!.depth + 1,
        children: [],
      });
      this.#byPointer.set(node.pointer, index);
      if (parent !== -1) this.entries[parent]!.children.push(index);

      const children = node.children;
      // Push in reverse so the stack pops them in document order.
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i]!, parent: index });
      }
    }
  }

  get size(): number {
    return this.entries.length;
  }

  node(index: number): HtmlNode {
    return this.entries[index]!.node;
  }

  indexOf(node: HtmlNode): number {
    const found = this.#byPointer.get(node.pointer);
    if (found === undefined) {
      throw new Error("node does not belong to this document");
    }
    return found;
  }

  /** Root-to-node tag tuple — Scrapling's `path` field, not an XPath. */
  pathOf(index: number): string[] {
    const parts: string[] = [];
    let current = index;
    while (current !== -1) {
      parts.push(this.entries[current]!.tag);
      current = this.entries[current]!.parent;
    }
    return parts.reverse();
  }

  fingerprint(index: number): Fingerprint {
    const entry = this.entries[index]!;
    const result: Fingerprint = {
      tag: entry.tag,
      attributes: cleanAttributes(entry.attrs),
      text: entry.ownText ? entry.ownText.trim() : null,
      path: this.pathOf(index),
    };

    if (entry.parent !== -1) {
      const parent = this.entries[entry.parent]!;
      result.parent_name = parent.tag;
      result.parent_attribs = { ...parent.attrs };
      result.parent_text = parent.ownText ? parent.ownText.trim() : null;

      const siblings = parent.children
        .filter((child) => child !== index)
        .map((child) => this.entries[child]!.tag);
      if (siblings.length > 0) result.siblings = siblings;
    }

    const children = entry.children.map((child) => this.entries[child]!.tag);
    if (children.length > 0) result.children = children;

    return result;
  }
}

/** Half key-sequence, half value-sequence similarity. */
export function dictDiff(
  left: Record<string, string>,
  right: Record<string, string>,
): number {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    ratio(leftKeys, rightKeys) * 0.5 +
    ratio(
      leftKeys.map((key) => left[key]!),
      rightKeys.map((key) => right[key]!),
    ) *
      0.5
  );
}

export function similarityScore(
  index: TreeIndex,
  original: Fingerprint,
  candidate: number,
): number {
  const data = index.fingerprint(candidate);
  let score = 0;
  let checks = 0;

  if (original.tag === data.tag) score += 1;
  checks += 1;

  if (original.text) {
    score += ratio(original.text, data.text ?? "");
    checks += 1;
  }

  score += dictDiff(original.attributes, data.attributes);
  checks += 1;

  for (const attribute of ATTRIBUTE_FEATURES) {
    const value = original.attributes[attribute];
    if (value) {
      score += ratio(value, data.attributes[attribute] ?? "");
      checks += 1;
    }
  }

  score += ratio(original.path, data.path);
  checks += 1;

  if (original.parent_name) {
    if (data.parent_name) {
      score += ratio(original.parent_name, data.parent_name ?? "");
      checks += 1;
      score += dictDiff(original.parent_attribs ?? {}, data.parent_attribs ?? {});
      checks += 1;
      if (original.parent_text) {
        score += ratio(original.parent_text, data.parent_text ?? "");
        checks += 1;
      }
    }
  }

  if (original.siblings) {
    score += ratio(original.siblings, data.siblings ?? []);
    checks += 1;
  }

  return pyRound2((score / checks) * 100);
}

/**
 * Scores every descendant, buckets by score, returns the highest bucket.
 * Rejects the result when the best score is below `percentage` (default 40).
 */
export function relocate(
  index: TreeIndex,
  original: Fingerprint,
  percentage = 40,
): RelocateResult {
  const buckets = new Map<number, number[]>();

  // Index 0 is the root; Scrapling scans `.//*`, so descendants only.
  for (let i = 1; i < index.size; i++) {
    const score = similarityScore(index, original, i);
    const bucket = buckets.get(score);
    if (bucket) bucket.push(i);
    else buckets.set(score, [i]);
  }

  if (buckets.size === 0) return { indices: [], top: null };

  const top = Math.max(...buckets.keys());
  if (top >= percentage) return { indices: buckets.get(top)!, top };
  return { indices: [], top };
}

function areAlike(
  index: TreeIndex,
  original: number,
  originalAttrs: Record<string, string>,
  candidate: number,
  ignoreAttributes: readonly string[],
  threshold: number,
  matchText: boolean,
): boolean {
  const candidateAttrs = ignoreAttributes.length
    ? attrsWithout(index.entries[candidate]!.attrs, ignoreAttributes)
    : index.entries[candidate]!.attrs;

  let score = 0;
  let checks = 0;

  const originalKeys = Object.keys(originalAttrs);
  if (originalKeys.length > 0) {
    for (const key of originalKeys) {
      score += ratio(originalAttrs[key]!, candidateAttrs[key] ?? "");
    }
    // max() penalises candidates with extra attributes; min() would inflate.
    checks += Math.max(originalKeys.length, Object.keys(candidateAttrs).length);
  } else if (Object.keys(candidateAttrs).length === 0) {
    score += 1;
    checks += 1;
  }

  if (matchText) {
    score += ratio(
      cleanSpaces(index.entries[original]!.ownText),
      cleanSpaces(index.entries[candidate]!.ownText),
    );
    checks += 1;
  }

  if (checks === 0) return 0 >= threshold;
  return pyRound2(score / checks) >= threshold;
}

/**
 * Finds elements at the same depth with the same tag, parent tag and grandparent
 * tag whose attributes are similar enough.
 */
export function findSimilar(
  index: TreeIndex,
  target: number,
  options: FindSimilarOptions = {},
): number[] {
  const {
    threshold = 0.2,
    ignoreAttributes = ["href", "src"],
    matchText = false,
  } = options;

  const root = index.entries[target]!;
  const targetAttrs = attrsWithout(root.attrs, ignoreAttributes);

  const parentIndex = root.parent;
  const grandIndex = parentIndex === -1 ? -1 : index.entries[parentIndex]!.parent;

  const results: number[] = [];
  for (let i = 0; i < index.size; i++) {
    if (i === target) continue;

    const candidate = index.entries[i]!;
    if (candidate.tag !== root.tag) continue;
    if (candidate.depth !== root.depth) continue;

    if (parentIndex !== -1) {
      if (candidate.parent === -1) continue;
      if (index.entries[candidate.parent]!.tag !== index.entries[parentIndex]!.tag) continue;
    }
    if (grandIndex !== -1) {
      const candidateGrand =
        candidate.parent === -1 ? -1 : index.entries[candidate.parent]!.parent;
      if (candidateGrand === -1) continue;
      if (index.entries[candidateGrand]!.tag !== index.entries[grandIndex]!.tag) continue;
    }

    if (
      areAlike(index, target, targetAttrs, i, ignoreAttributes, threshold, matchText)
    ) {
      results.push(i);
    }
  }

  return results;
}
