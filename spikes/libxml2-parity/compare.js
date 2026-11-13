// Compare the two normalised outputs and report divergences.
const fs = require("fs");

const a = JSON.parse(fs.readFileSync(process.argv[2] || "out-node.json", "utf8"));
const b = JSON.parse(fs.readFileSync(process.argv[3] || "out-python.json", "utf8"));

const ids = Object.keys(b);
let pass = 0;
const failures = [];

for (const id of ids) {
  const n = a[id] || {};
  const p = b[id] || {};
  const diffs = [];

  const norm = (arr) =>
    arr.map((e) => ({
      d: e.d,
      t: e.t,
      a: Object.fromEntries(
        Object.keys(e.a || {})
          .sort()
          .map((k) => [k, e.a[k]])
      ),
    }));
  const skN = norm(n.skeleton || []);
  const skP = norm(p.skeleton || []);
  if (JSON.stringify(skN) !== JSON.stringify(skP)) {
    const max = Math.max(skN.length, skP.length);
    for (let i = 0; i < max; i++) {
      if (JSON.stringify(skN[i]) !== JSON.stringify(skP[i])) {
        diffs.push({
          where: "skeleton",
          index: i,
          node: JSON.stringify(skN[i]) ?? "<missing>",
          lxml: JSON.stringify(skP[i]) ?? "<missing>",
        });
        if (diffs.length >= 4) break;
      }
    }
    diffs.push({ where: "skeleton", nodeCount: skN.length, lxmlCount: skP.length });
  }

  for (const x of Object.keys(p.xpath || {})) {
    const vn = (n.xpath || {})[x];
    const vp = (p.xpath || {})[x];
    if (JSON.stringify(vn) !== JSON.stringify(vp)) {
      diffs.push({ where: "xpath", expr: x, node: vn, lxml: vp });
    }
  }

  if (diffs.length === 0) pass++;
  else failures.push({ id, diffs });
}

const total = ids.length;
const summary = {
  total,
  pass,
  fail: failures.length,
  passRate: Math.round((pass / total) * 100) + "%",
};
console.log(JSON.stringify({ summary, failures }, null, 2));
fs.writeFileSync("parity-report.json", JSON.stringify({ summary, failures }, null, 2));
