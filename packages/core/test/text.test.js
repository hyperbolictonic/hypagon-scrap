import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { Page, cleanText } from "../dist/index.js";

/**
 * Golden file from Scrapling 0.5.1 (spikes/text-parity/py-ref.py).
 * Text output is exactly comparable, so equality here is strict.
 */

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/text-corpus.json", import.meta.url), "utf8"),
);
const golden = JSON.parse(
  readFileSync(new URL("./fixtures/text-golden.json", import.meta.url), "utf8"),
);

const pick = (args, mapping) => {
  const out = {};
  for (const [from, to] of mapping) {
    if (args[from] !== undefined) out[to] = args[from];
  }
  return out;
};

function apply(base, operation) {
  const args = operation.args ?? {};

  if (operation.kind === "all_text") {
    return base.getAllText({
      ...(args.separator !== undefined ? { separator: args.separator } : {}),
      ...(args.strip !== undefined ? { strip: args.strip } : {}),
      ...(args.ignore_tags !== undefined ? { ignoreTags: args.ignore_tags } : {}),
      ...(args.valid_values !== undefined ? { validValues: args.valid_values } : {}),
    });
  }

  if (operation.kind === "find_text") {
    return base
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
  }

  return base
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

test("text fixture covers 33 operations", () => {
  const total = Object.values(golden).reduce(
    (sum, operations) => sum + Object.keys(operations).length,
    0,
  );
  assert.equal(total, 33);
});

for (const document of corpus.documents) {
  test(`text parity: ${document.id}`, async () => {
    const page = await Page.load(document.html);
    try {
      for (const operation of corpus.operations) {
        const allowed = operation.documents;
        if (allowed && !allowed.includes(document.id)) continue;

        const expected = golden[document.id][operation.id];
        assert.ok(expected !== undefined, `missing golden for ${operation.id}`);

        let base = page.root;
        if (operation.selector) {
          base = page.css(operation.selector)[0];
          assert.ok(base, `selector ${operation.selector} should resolve`);
        }

        assert.deepEqual(apply(base, operation), expected, operation.id);
      }
    } finally {
      page.dispose();
    }
  });
}

test("text is own text; getAllText is the deep walk", async () => {
  const page = await Page.load(
    "<html><body><div>own<span>inner</span>tail</div></body></html>",
  );
  try {
    const [div] = page.css("div");
    assert.equal(div.text, "own");
    assert.equal(div.ownText, "own");
    assert.equal(div.getAllText(), "own\ninner\ntail");
    assert.equal(div.getAllText({ separator: "" }), "owninnertail");
  } finally {
    page.dispose();
  }
});

test("cleanText matches TextHandler.clean", () => {
  assert.equal(cleanText("  a\t b \n c "), "a b c");
  assert.equal(cleanText("one   two"), "one two");
  assert.equal(cleanText(""), "");
});
