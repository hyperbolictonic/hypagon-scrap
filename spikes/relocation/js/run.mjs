// S5 runner: the ported relocation pipeline against the same corpus as py-ref.py.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

// HX_MODULE lets the same corpus validate a different build of the parser
// (e.g. the packaged multi-document artifact) without touching the spike.
const moduleUrl = process.env.HX_MODULE
  ? pathToFileURL(process.env.HX_MODULE).href
  : new URL("../../libxml2-wasm/build/hx.mjs", import.meta.url).href;
const createHxModule = (await import(moduleUrl)).default;

import {
  buildRegistry,
  elementToDict,
  similarityScore,
  relocate,
  findSimilar,
} from "./relocation.mjs";

const M = await (typeof createHxModule === "function" ? createHxModule() : createHxModule.default());

const raw = {
  parse: M.cwrap("hx_parse", "number", ["string", "number", "string"]),
  type: M.cwrap("hx_type", "number", ["number"]),
  name: M.cwrap("hx_name", "number", ["number"]),
  textRaw: M.cwrap("hx_text", "number", ["number"]),
  childCount: M.cwrap("hx_child_count", "number", ["number"]),
  childAt: M.cwrap("hx_child_at", "number", ["number", "number"]),
  attrCount: M.cwrap("hx_attr_count", "number", ["number"]),
  attrName: M.cwrap("hx_attr_name", "number", ["number", "number"]),
  attrValueRaw: M.cwrap("hx_attr_value", "number", ["number", "number"]),
  pathRaw: M.cwrap("hx_path", "number", ["number"]),
  freeStr: M.cwrap("hx_free_str", null, ["number"]),
  xpath: M.cwrap("hx_xpath", "number", ["number", "string"]),
  xpathSize: M.cwrap("hx_xpath_size", "number", ["number"]),
  xpathItem: M.cwrap("hx_xpath_item", "number", ["number", "number"]),
  xpathFree: M.cwrap("hx_xpath_free", null, ["number"]),
};

const str = (p) => (p ? M.UTF8ToString(p) : "");
const take = (p) => {
  if (!p) return "";
  const s = M.UTF8ToString(p);
  raw.freeStr(p);
  return s;
};

const A = {
  type: raw.type,
  name: (p) => str(raw.name(p)),
  text: (p) => take(raw.textRaw(p)),
  childCount: raw.childCount,
  childAt: raw.childAt,
  attrCount: raw.attrCount,
  attrName: (p, i) => str(raw.attrName(p, i)),
  attrValue: (p, i) => take(raw.attrValueRaw(p, i)),
  path: (p) => take(raw.pathRaw(p)),
  root: 0,
};

function parseDoc(html) {
  // Scrapling strips leading/trailing whitespace before parsing.
  const body = html.trim() || "<html/>";
  const doc = raw.parse(body, M.lengthBytesUTF8(body), "UTF-8");
  if (!doc) throw new Error("parse failed");
  let root = 0;
  const n = raw.childCount(doc);
  for (let i = 0; i < n; i++) {
    const c = raw.childAt(doc, i);
    if (c && raw.type(c) === 1) {
      root = c;
      break;
    }
  }
  return { doc, root };
}

function xpathFirst(doc, expr) {
  const obj = raw.xpath(doc, expr);
  if (!obj) return 0;
  try {
    return raw.xpathSize(obj) > 0 ? raw.xpathItem(obj, 0) : 0;
  } finally {
    raw.xpathFree(obj);
  }
}

const corpus = JSON.parse(fs.readFileSync(process.argv[3] || "corpus.json", "utf8"));
const out = {};

for (const c of corpus) {
  const entry = {};
  try {
    const orig = parseDoc(c.original);
    const origTarget = xpathFirst(orig.doc, c.target);
    if (!origTarget) {
      entry.error = "target not found in original";
      out[c.id] = entry;
      continue;
    }
    const origReg = buildRegistry({ ...A, root: orig.root });
    const origIdx = origReg.findIndex((n) => n.ptr === origTarget);
    const fp = elementToDict(origReg, origIdx);

    // Must run before parsing the changed document: hx_parse keeps a single
    // static document and frees the previous one, which would dangle every
    // pointer in origReg.
    const similarSame = findSimilar(origReg, origIdx).map((i) => A.path(origReg[i].ptr));

    const chg = parseDoc(c.changed);
    const reg = buildRegistry({ ...A, root: chg.root });

    const scores = {};
    for (let i = 1; i < reg.length; i++) {
      scores[A.path(reg[i].ptr)] = similarityScore(reg, fp, i);
    }

    const rel = relocate(reg, fp);

    const chgTarget = xpathFirst(chg.doc, c.target);
    let similarChanged = [];
    if (chgTarget) {
      const idx = reg.findIndex((n) => n.ptr === chgTarget);
      if (idx !== -1) similarChanged = findSimilar(reg, idx).map((i) => A.path(reg[i].ptr));
    }

    entry.fp = fp;    entry.scores = scores;
    entry.relocate = rel.indices.map((i) => A.path(reg[i].ptr));
    entry.findSimilarSameTree = similarSame;
    entry.findSimilarChangedTree = similarChanged;
  } catch (e) {
    entry.error = `${e.name}: ${e.message}`.slice(0, 300);
  }
  out[c.id] = entry;
}

const dest = process.argv[2] || "out-js.json";
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`wrote ${dest}: ${Object.keys(out).length} cases`);
