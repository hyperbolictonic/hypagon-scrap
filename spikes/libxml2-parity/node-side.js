// Node side: libxmljs2 (real libxml2) -> normalised JSON
const fs = require("fs");
const libxml = require("libxmljs2");
const corpus = require("./corpus.json");

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

function skeleton(doc) {
  const out = [];
  (function walk(parent, depth) {
    for (const c of parent.childNodes()) {
      if (c.type() === "element") {
        const attrs = {};
        for (const a of c.attrs()) attrs[a.name()] = a.value();
        out.push({ d: depth, t: c.name(), a: attrs });
        walk(c, depth + 1);
      }
    }
  })(doc, 0);
  return out;
}

function xpath(doc, expr) {
  let res;
  try {
    res = doc.find(expr);
  } catch (e) {
    return { error: String(e.message || e).slice(0, 80) };
  }
  if (typeof res === "number") return { num: res };
  return {
    items: res.map((n) => {
      const type = n.type();
      if (type === "attribute") return "attr:" + n.value().trim();
      if (type === "text") return "text:" + n.text().trim();
      return `<${n.name()}>${(n.text() || "").trim()}`;
    }),
  };
}

const result = {};
for (const c of corpus) {
  const entry = {};
  try {
    const doc = libxml.parseHtml(c.html, { nonet: true });
    entry.skeleton = skeleton(doc);
    entry.xpath = {};
    for (const x of XPATHS) entry.xpath[x] = xpath(doc, x);
  } catch (e) {
    entry.parseError = String(e.message || e).slice(0, 120);
  }
  result[c.id] = entry;
}
fs.writeFileSync(process.argv[2] || "out-node.json", JSON.stringify(result, null, 1));
console.log("node side wrote", Object.keys(result).length, "cases");
