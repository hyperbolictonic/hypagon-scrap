import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { Page, similarityScore } from "../dist/index.js";

/**
 * Golden files produced by Scrapling 0.5.1 (see spikes/relocation/py-ref.py).
 *
 * The comparison is deliberately the whole per-candidate score table, not just
 * the winning element: a port can return the right element with every score
 * subtly wrong.
 */

const suites = [
  { corpus: "corpus.json", expected: "expected-curated.json" },
  { corpus: "corpus-fuzz.json", expected: "expected-fuzz.json" },
  { corpus: "corpus-long.json", expected: "expected-long.json" },
];

const read = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

let cases = 0;

for (const suite of suites) {
  const corpus = read(suite.corpus);
  const expected = read(suite.expected);

  for (const item of corpus) {
    const want = expected[item.id];
    if (!want || want.error) continue;
    cases++;

    test(`parity: ${item.id}`, async () => {
      const original = await Page.load(item.original);
      const changed = await Page.load(item.changed);

      try {
        const target = original.xpath(item.target)[0];
        assert.ok(target, "target resolves in the original document");

        const fingerprint = target.fingerprint();
        assert.deepEqual(fingerprint, want.fp, "fingerprint");

        const index = changed.index;
        const scores = {};
        for (let i = 1; i < index.size; i++) {
          scores[index.node(i).path] = similarityScore(index, fingerprint, i);
        }
        assert.deepEqual(scores, want.scores, "full score table");

        assert.deepEqual(
          changed.relocate(fingerprint).map((selector) => selector.path),
          want.relocate,
          "relocate result",
        );

        assert.deepEqual(
          target.findSimilar().map((selector) => selector.path),
          want.findSimilarSameTree,
          "findSimilar on the original tree",
        );

        const movedTarget = changed.xpath(item.target)[0];
        const similarChanged = movedTarget
          ? movedTarget.findSimilar().map((selector) => selector.path)
          : [];
        assert.deepEqual(
          similarChanged,
          want.findSimilarChangedTree,
          "findSimilar on the changed tree",
        );
      } finally {
        original.dispose();
        changed.dispose();
      }
    });
  }
}

test("golden corpus covers all 53 cases", () => {
  assert.equal(cases, 53);
});
