// Port of Scrapling's adaptive relocation, operating on the WASM libxml2 tree.
//
// Mirrors scrapling/parser.py:
//   _StorageTools.element_to_dict      -> elementToDict
//   __calculate_similarity_score       -> similarityScore
//   __calculate_dict_diff              -> dictDiff
//   relocate                           -> relocate
//   __are_alike / find_similar         -> areAlike / findSimilar
//
// The tree is walked once into a flat registry (document order) instead of
// re-walking per candidate. That is an internal optimisation; it must not change
// outputs, so ordering and field construction follow the Python exactly.
import { ratio, pyRound2 } from "./difflib.mjs";

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
const NODE_COMMENT = 8;

/** Build a document-order registry. Index 0 is the root element. */
export function buildRegistry(A) {
  // A = { root, type, name, text, childCount, childAt, attrCount, attrName, attrValue, path }
  const nodes = [];

  const attrsOf = (ptr) => {
    const out = {};
    const n = A.attrCount(ptr);
    for (let i = 0; i < n; i++) out[A.attrName(ptr, i)] = A.attrValue(ptr, i);
    return out;
  };

  // lxml's .text is the text before the first child element. Comments are
  // removed by the parser, so skip them when locating that first child.
  const ownTextOf = (ptr) => {
    const n = A.childCount(ptr);
    for (let i = 0; i < n; i++) {
      const c = A.childAt(ptr, i);
      const t = A.type(c);
      if (t === NODE_COMMENT) continue;
      if (t === NODE_TEXT) return A.text(c);
      return null;
    }
    return null;
  };

  const visit = (ptr, parentIdx) => {
    const idx = nodes.length;
    nodes.push({
      ptr,
      tag: A.name(ptr),
      attrs: attrsOf(ptr),
      ownText: ownTextOf(ptr),
      parentIdx,
      depth: parentIdx === -1 ? 0 : nodes[parentIdx].depth + 1,
      childIdxs: [],
    });
    const n = A.childCount(ptr);
    for (let i = 0; i < n; i++) {
      const c = A.childAt(ptr, i);
      if (A.type(c) !== NODE_ELEMENT) continue;
      const childIdx = visit(c, idx);
      nodes[idx].childIdxs.push(childIdx);
    }
    return idx;
  };

  visit(A.root, -1);
  return nodes;
}

/** Root-to-node tag tuple, as Python's _get_element_path builds it. */
export function tagPath(nodes, idx) {
  const parts = [];
  let cur = idx;
  while (cur !== -1) {
    parts.push(nodes[cur].tag);
    cur = nodes[cur].parentIdx;
  }
  return parts.reverse();
}

const cleanAttrs = (attrs) => {
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
};

export function elementToDict(nodes, idx) {
  const n = nodes[idx];
  const dict = {
    tag: n.tag,
    attributes: cleanAttrs(n.attrs),
    text: n.ownText ? n.ownText.trim() : null,
    path: tagPath(nodes, idx),
  };

  if (n.parentIdx !== -1) {
    const p = nodes[n.parentIdx];
    dict.parent_name = p.tag;
    dict.parent_attribs = { ...p.attrs };
    dict.parent_text = p.ownText ? p.ownText.trim() : null;

    const siblings = p.childIdxs.filter((c) => c !== idx).map((c) => nodes[c].tag);
    if (siblings.length) dict.siblings = siblings;
  }

  const children = n.childIdxs.map((c) => nodes[c].tag);
  if (children.length) dict.children = children;

  return dict;
}

/** __calculate_dict_diff: half key-sequence, half value-sequence. */
export function dictDiff(d1, d2) {
  const k1 = Object.keys(d1);
  const k2 = Object.keys(d2);
  const v1 = k1.map((k) => d1[k]);
  const v2 = k2.map((k) => d2[k]);
  return ratio(k1, k2) * 0.5 + ratio(v1, v2) * 0.5;
}

export function similarityScore(nodes, original, idx) {
  const data = elementToDict(nodes, idx);
  let score = 0;
  let checks = 0;

  if (original.tag === data.tag) score += 1;
  checks += 1;

  if (original.text) {
    score += ratio(original.text, data.text || "");
    checks += 1;
  }

  score += dictDiff(original.attributes, data.attributes);
  checks += 1;

  for (const attrib of ["class", "id", "href", "src"]) {
    if (original.attributes[attrib]) {
      score += ratio(original.attributes[attrib], data.attributes[attrib] || "");
      checks += 1;
    }
  }

  score += ratio(original.path, data.path);
  checks += 1;

  if (original.parent_name) {
    if (data.parent_name) {
      score += ratio(original.parent_name, data.parent_name || "");
      checks += 1;
      score += dictDiff(original.parent_attribs, data.parent_attribs || {});
      checks += 1;
      if (original.parent_text) {
        score += ratio(original.parent_text, data.parent_text || "");
        checks += 1;
      }
    }
  }

  if (original.siblings) {
    score += ratio(original.siblings, data.siblings || []);
    checks += 1;
  }

  return pyRound2((score / checks) * 100);
}

/** relocate(): score every descendant, bucket by score, return the top bucket. */
export function relocate(nodes, original, percentage = 40, includeRoot = false) {
  const table = new Map();
  for (let i = includeRoot ? 0 : 1; i < nodes.length; i++) {
    const s = similarityScore(nodes, original, i);
    const bucket = table.get(s);
    if (bucket) bucket.push(i);
    else table.set(s, [i]);
  }
  if (!table.size) return { indices: [], top: null, table };
  const top = Math.max(...table.keys());
  if (top >= percentage) return { indices: table.get(top), top, table };
  return { indices: [], top, table };
}

function cleanSpaces(s) {
  return s
    .replace(/\t/g, " ")
    .replace(/[\n\r]/g, "")
    .replace(/ +/g, " ");
}

const attrsWithout = (attrs, ignore) => {
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!ignore.includes(k)) out[k] = v;
  }
  return out;
};

function areAlike(nodes, originalIdx, originalAttrs, candIdx, ignore, threshold, matchText) {
  const candAttrs = ignore && ignore.length
    ? attrsWithout(nodes[candIdx].attrs, ignore)
    : nodes[candIdx].attrs;

  let score = 0;
  let checks = 0;

  const origKeys = Object.keys(originalAttrs);
  if (origKeys.length) {
    for (const k of origKeys) {
      score += ratio(originalAttrs[k], candAttrs[k] ?? "");
    }
    checks += Math.max(origKeys.length, Object.keys(candAttrs).length);
  } else if (!Object.keys(candAttrs).length) {
    score += 1;
    checks += 1;
  }

  if (matchText) {
    score += ratio(
      cleanSpaces(nodes[originalIdx].ownText || ""),
      cleanSpaces(nodes[candIdx].ownText || ""),
    );
    checks += 1;
  }

  if (checks) return pyRound2(score / checks) >= threshold;
  return 0 >= threshold;
}

/** find_similar(): structural candidates (depth + tag + parent + grandparent). */
export function findSimilar(nodes, idx, opts = {}) {
  const { threshold = 0.2, ignoreAttributes = ["href", "src"], matchText = false } = opts;
  const root = nodes[idx];

  const targetAttrs = ignoreAttributes && ignoreAttributes.length
    ? attrsWithout(root.attrs, ignoreAttributes)
    : root.attrs;

  const parentIdx = root.parentIdx;
  const grandIdx = parentIdx !== -1 ? nodes[parentIdx].parentIdx : -1;

  const results = [];
  for (let i = 0; i < nodes.length; i++) {
    if (i === idx) continue;
    const cand = nodes[i];
    if (cand.tag !== root.tag) continue;
    if (cand.depth !== root.depth) continue;
    if (parentIdx !== -1) {
      if (cand.parentIdx === -1) continue;
      if (nodes[cand.parentIdx].tag !== nodes[parentIdx].tag) continue;
    }
    if (grandIdx !== -1) {
      const candGrand = cand.parentIdx !== -1 ? nodes[cand.parentIdx].parentIdx : -1;
      if (candGrand === -1) continue;
      if (nodes[candGrand].tag !== nodes[grandIdx].tag) continue;
    }
    if (areAlike(nodes, idx, targetAttrs, i, ignoreAttributes, threshold, matchText)) {
      results.push(i);
    }
  }
  return results;
}
