import { test } from "node:test";
import assert from "node:assert/strict";

import { pyRound2, ratio } from "../dist/index.js";

test("ratio matches difflib on basic cases", () => {
  assert.equal(ratio("", ""), 1);
  assert.equal(ratio("abc", "abc"), 1);
  assert.equal(ratio("abc", ""), 0);
  assert.equal(ratio("abcd", "abxd"), 0.75); // 2 * 3 matched / 8 total
  assert.equal(ratio(["div", "p"], ["div", "p"]), 1);
});

test("ratio treats strings as code points, not UTF-16 units", () => {
  // One code point each: 1 match over 4 items = 0.5. If the port counted UTF-16
  // units, the surrogate pair would weigh 2 and this would be 2/3.
  assert.equal(ratio("😀", "😀"), 1);
  assert.equal(ratio("😀x", "😀y"), 0.5);
});

test("pyRound2 uses banker's rounding", () => {
  // Exactly representable ties round to even, unlike Math.round.
  assert.equal(pyRound2(0.125), 0.12);
  assert.equal(pyRound2(0.375), 0.38);

  // Not a tie in binary: 2.675 is 2.67499..., so Python rounds down.
  assert.equal(pyRound2(2.675), 2.67);
  assert.equal(Math.round(2.675 * 100) / 100, 2.68); // the naive JS answer
});
