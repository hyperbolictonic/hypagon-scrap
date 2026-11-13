// Compare the ported CSS->XPath translator against cssselect, by selected nodes.
import { readFileSync } from "node:fs";

import { Page, cssToXpath, CssSelectorError } from "../../packages/core/dist/index.js";

const corpus = JSON.parse(readFileSync(new URL("./corpus.json", import.meta.url), "utf8"));
const golden = JSON.parse(
  readFileSync(new URL(process.argv[2] ?? "./css-golden.json", import.meta.url), "utf8"),
);

let checked = 0;
let failed = 0;
const failures = [];

for (const doc of corpus.documents) {
  const page = await Page.load(doc.html);
  try {
    for (const selector of corpus.selectors) {
      const want = golden[doc.id]?.[selector];
      if (!want) continue;
      checked++;

      let actual;
      let error = null;
      try {
        actual = page.css(selector).map((node) => node.path);
      } catch (e) {
        error = e instanceof CssSelectorError ? e.message : `${e.name}: ${e.message}`;
      }

      if (want.error) {
        if (!error) {
          failed++;
          failures.push({ doc: doc.id, selector, expected: want.error, actual: actual.slice(0, 3) });
        }
        continue;
      }

      if (error) {
        failed++;
        failures.push({ doc: doc.id, selector, expected: want.paths, actual: `error: ${error}` });
        continue;
      }

      const same = JSON.stringify(actual) === JSON.stringify(want.paths);
      if (!same) {
        failed++;
        failures.push({
          doc: doc.id,
          selector,
          xpath: want.xpath,
          expected: want.paths,
          actual,
        });
      }
    }
  } finally {
    page.dispose();
  }
}

console.log(JSON.stringify({ checked, failed, passRate: `${Math.round(((checked - failed) / checked) * 100)}%` }, null, 1));
for (const failure of failures.slice(0, 15)) {
  console.log("\n---", failure.doc, "|", failure.selector);
  if (failure.xpath) console.log("cssselect xpath:", failure.xpath);
  console.log("expected:", JSON.stringify(failure.expected));
  console.log("actual  :", JSON.stringify(failure.actual));
}
