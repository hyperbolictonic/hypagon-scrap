// WASM side: libxml2 2.11.9 + hx_wrapper -> the same normalised JSON as the others.
import fs from "node:fs";
import createHxModule from "./build/hx.mjs";

const M = await (typeof createHxModule === "function" ? createHxModule() : createHxModule.default());
const corpus = JSON.parse(fs.readFileSync("corpus.json", "utf8"));

const c = {
  parse: M.cwrap("hx_parse", "number", ["string", "number", "string"]),
  type: M.cwrap("hx_type", "number", ["number"]),
  name: M.cwrap("hx_name", "number", ["number"]),
  text: M.cwrap("hx_text", "number", ["number"]),
  childCount: M.cwrap("hx_child_count", "number", ["number"]),
  childAt: M.cwrap("hx_child_at", "number", ["number", "number"]),
  attrCount: M.cwrap("hx_attr_count", "number", ["number"]),
  attrName: M.cwrap("hx_attr_name", "number", ["number", "number"]),
  attrValue: M.cwrap("hx_attr_value", "number", ["number", "number"]),
  path: M.cwrap("hx_path", "number", ["number"]),
  freeStr: M.cwrap("hx_free_str", null, ["number"]),
  xpath: M.cwrap("hx_xpath", "number", ["number", "string"]),
  xpathType: M.cwrap("hx_xpath_type", "number", ["number"]),
  xpathSize: M.cwrap("hx_xpath_size", "number", ["number"]),
  xpathItem: M.cwrap("hx_xpath_item", "number", ["number", "number"]),
  xpathNumber: M.cwrap("hx_xpath_number", "number", ["number"]),
  xpathFree: M.cwrap("hx_xpath_free", null, ["number"]),
};

const XPATH_NODESET = 1;
const XPATH_NUMBER = 3;
const NODE_ELEMENT = 1;
const NODE_ATTRIBUTE = 2;
const NODE_TEXT = 3;

// Allocated by libxml2 (xmlNodeGetContent / xmlGetNodePath) -> must free.
function take(ptr) {
  if (!ptr) return "";
  const s = M.UTF8ToString(ptr);
  c.freeStr(ptr);
  return s;
}
// Interned in the document dictionary -> must NOT be freed (freeing corrupts it).
function str(ptr) {
  return ptr ? M.UTF8ToString(ptr) : "";
}

function skeleton(doc) {
  const out = [];
  // lxml's document_fromstring returns the <html> element, and the walk starts
  // at its children, so the first emitted node is <body>. Match that.
  let root = 0;
  const rc = c.childCount(doc);
  for (let i = 0; i < rc; i++) {
    const n = c.childAt(doc, i);
    if (n && c.type(n) === NODE_ELEMENT) { root = n; break; }
  }
  if (!root) return out;
  (function walk(parent, depth) {
    const n = c.childCount(parent);
    for (let i = 0; i < n; i++) {
      const kid = c.childAt(parent, i);
      if (!kid || c.type(kid) !== NODE_ELEMENT) continue;
      const attrs = {};
      const an = c.attrCount(kid);
      for (let a = 0; a < an; a++) attrs[str(c.attrName(kid, a))] = take(c.attrValue(kid, a));
      out.push({ d: depth, t: str(c.name(kid)), a: attrs });
      walk(kid, depth + 1);
    }
  })(root, 0);
  return out;
}

function xpath(doc, expr) {
  const obj = c.xpath(doc, expr);
  if (!obj) return { error: "null xpath object" };
  try {
    const t = c.xpathType(obj);
    if (t === XPATH_NUMBER) return { num: c.xpathNumber(obj) };
    const items = [];
    const n = c.xpathSize(obj);
    for (let i = 0; i < n; i++) {
      const node = c.xpathItem(obj, i);
      if (!node) continue;
      const nt = c.type(node);
      const val = take(c.text(node)).trim();
      if (nt === NODE_ATTRIBUTE) items.push("attr:" + val);
      else if (nt === NODE_TEXT) items.push("text:" + val);
      else items.push(`<${str(c.name(node))}>${val}`);
    }
    return { items };
  } finally {
    c.xpathFree(obj);
  }
}

const XPATHS = [
  "//div",
  "//p",
  "//span",
  "//td",
  "//*[@class]",
  "//a/@href",
  "count(//div)",
  "//div[@id='x']",
  "//*[text()]",
  "//table//td[2]",
];

const result = {};
for (const item of corpus) {
  const entry = {};
  try {
    const len = M.lengthBytesUTF8(item.html);
    const doc = c.parse(item.html, len, "UTF-8");
    if (!doc) throw new Error("parse returned null");
    entry.skeleton = skeleton(doc);
    entry.xpath = {};
    for (const x of XPATHS) entry.xpath[x] = xpath(doc, x);
  } catch (e) {
    entry.parseError = String(e.message || e).slice(0, 120);
  }
  result[item.id] = entry;
}

const out = process.argv[2] || "out-wasm.json";
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log("wasm side wrote", Object.keys(result).length, "cases");
