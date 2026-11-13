// Compare the ported pipeline against Scrapling's own output.
import fs from "node:fs";

const py = JSON.parse(fs.readFileSync(process.argv[2] || "out-python.json", "utf8"));
const js = JSON.parse(fs.readFileSync(process.argv[3] || "out-js.json", "utf8"));

const cases = [...new Set([...Object.keys(py), ...Object.keys(js)])].sort();
const report = { summary: {}, cases: [] };
let pass = 0;

for (const id of cases) {
  const a = py[id] || {};
  const b = js[id] || {};
  const diffs = [];

  if (a.error || b.error) {
    if (a.error !== b.error) diffs.push({ where: "error", py: a.error ?? null, js: b.error ?? null });
  } else {
    // fingerprint
    if (JSON.stringify(a.fp) !== JSON.stringify(b.fp)) {
      const keys = new Set([...Object.keys(a.fp || {}), ...Object.keys(b.fp || {})]);
      for (const k of keys) {
        if (JSON.stringify(a.fp?.[k]) !== JSON.stringify(b.fp?.[k])) {
          diffs.push({ where: `fp.${k}`, py: a.fp?.[k], js: b.fp?.[k] });
        }
      }
    }

    // full score table
    const pa = a.scores || {};
    const pb = b.scores || {};
    const paths = new Set([...Object.keys(pa), ...Object.keys(pb)]);
    let scoreDiffs = 0;
    for (const p of paths) {
      if (pa[p] !== pb[p]) {
        scoreDiffs++;
        if (scoreDiffs <= 5) diffs.push({ where: "score", path: p, py: pa[p] ?? null, js: pb[p] ?? null });
      }
    }
    if (scoreDiffs > 5) diffs.push({ where: "score", note: `${scoreDiffs} score mismatches total` });

    for (const key of ["relocate", "findSimilarSameTree", "findSimilarChangedTree"]) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        diffs.push({ where: key, py: a[key], js: b[key] });
      }
    }
  }

  report.cases.push({ id, pass: diffs.length === 0, diffs });
  if (!diffs.length) pass++;
}

report.summary = { total: cases.length, pass, fail: cases.length - pass, passRate: `${Math.round((pass / cases.length) * 100)}%` };
console.log(JSON.stringify(report, null, 1));
fs.writeFileSync("relocation-report.json", JSON.stringify(report, null, 1));
