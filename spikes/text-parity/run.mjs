// Compare the ported text helpers against Scrapling, exactly.
import { readFileSync } from "node:fs";

import { Page } from "../../packages/core/dist/index.js";

const corpus = JSON.parse(readFileSync(new URL("./corpus.json", import.meta.url), "utf8"));
const golden = JSON.parse(
  readFileSync(new URL(process.argv[2] ?? "./text-golden.json", import.meta.url), "utf8"),
);

const pick = (args, mapping) => {
  const out = {};
  for (const [from, to] of mapping) {
    if (args[from] !== undefined) out[to] = args[from];
  }
  return out;
};

let checked = 0;
const failures = [];

for (const document of corpus.documents) {
  const page = await Page.load(document.html);
  try {
    for (const operation of corpus.operations) {
      const allowed = operation.documents;
      if (allowed && !allowed.includes(document.id)) continue;

      const expected = golden[document.id][operation.id];
      if (expected === undefined) continue;
      checked++;

      let actual;
      try {
        let base = page.root;
        if (operation.selector) {
          base = page.css(operation.selector)[0];
        }
        if (!base) {
          actual = { error: "selector not found" };
        } else if (operation.kind === "all_text") {
          const args = operation.args ?? {};
          actual = base.getAllText({
            ...(args.separator !== undefined ? { separator: args.separator } : {}),
            ...(args.strip !== undefined ? { strip: args.strip } : {}),
            ...(args.ignore_tags !== undefined ? { ignoreTags: args.ignore_tags } : {}),
            ...(args.valid_values !== undefined ? { validValues: args.valid_values } : {}),
          });
        } else if (operation.kind === "find_text") {
          const args = operation.args ?? {};
          actual = base
            .findByText(
              args.text,
              pick(args, [
                ["first_match", "firstMatch"],
                ["partial", "partial"],
                ["case_sensitive", "caseSensitive"],
                ["clean_match", "cleanMatch"],
              ]),
            )
            .map((node) => node.path);
        } else if (operation.kind === "find_regex") {
          const args = operation.args ?? {};
          actual = base
            .findByRegex(
              args.query,
              pick(args, [
                ["first_match", "firstMatch"],
                ["case_sensitive", "caseSensitive"],
                ["clean_match", "cleanMatch"],
              ]),
            )
            .map((node) => node.path);
        }
      } catch (error) {
        actual = { error: `${error.name}: ${error.message}` };
      }

      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push({ doc: document.id, op: operation.id, expected, actual });
      }
    }
  } finally {
    page.dispose();
  }
}

console.log(
  JSON.stringify(
    {
      checked,
      failed: failures.length,
      passRate: `${Math.round(((checked - failures.length) / checked) * 100)}%`,
    },
    null,
    1,
  ),
);
for (const failure of failures) {
  console.log("\n---", failure.doc, "|", failure.op);
  console.log("expected:", JSON.stringify(failure.expected));
  console.log("actual  :", JSON.stringify(failure.actual));
}
