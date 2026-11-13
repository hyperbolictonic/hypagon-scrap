import { test } from "node:test";
import assert from "node:assert/strict";

import { HtmlDocument } from "../dist/index.js";

/**
 * These tests exist because the S5 spike held a single static document and
 * freed it on the next parse, so the first tree's node pointers dangled and
 * silently returned empty strings.
 */

test("two live documents stay independent", async () => {
  const first = await HtmlDocument.parse("<html><body><p id='a'>A</p></body></html>");
  const second = await HtmlDocument.parse("<html><body><p id='b'>B</p></body></html>");

  try {
    assert.equal(first.xpath("//p")[0].attrs.id, "a");
    assert.equal(second.xpath("//p")[0].attrs.id, "b");

    // The first document must still be intact after the second was parsed.
    assert.equal(first.xpath("//p")[0].ownText, "A");
    assert.equal(first.xpath("//p")[0].path, "/html/body/p");
    assert.equal(second.xpath("//p")[0].ownText, "B");
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("disposing one document leaves the other usable", async () => {
  const first = await HtmlDocument.parse("<html><body><p>first</p></body></html>");
  const second = await HtmlDocument.parse("<html><body><p>second</p></body></html>");

  first.dispose();
  assert.equal(first.disposed, true);
  assert.equal(second.disposed, false);
  assert.equal(second.xpath("//p")[0].ownText, "second");

  second.dispose();
});

test("node handles fail loudly after their document is disposed", async () => {
  const doc = await HtmlDocument.parse("<html><body><p>x</p></body></html>");
  const [p] = doc.xpath("//p");
  doc.dispose();

  assert.throws(() => p.ownText, /disposed/);
  assert.throws(() => doc.xpath("//p"), /disposed/);
  assert.throws(() => doc.root, /disposed/);
});

test("dispose is idempotent", async () => {
  const doc = await HtmlDocument.parse("<html><body></body></html>");
  doc.dispose();
  doc.dispose();
  assert.equal(doc.disposed, true);
});

test("survives many parse/dispose cycles", async () => {
  for (let i = 0; i < 300; i++) {
    const doc = await HtmlDocument.parse(`<html><body><p>${i}</p></body></html>`);
    assert.equal(doc.xpath("//p")[0].ownText, String(i));
    doc.dispose();
  }
});

test("exposes Symbol.dispose for explicit resource management", async () => {
  const doc = await HtmlDocument.parse("<html><body><p>scoped</p></body></html>");
  try {
    assert.equal(doc.xpath("//p")[0].ownText, "scoped");
  } finally {
    if (typeof Symbol.dispose === "symbol") {
      // `await using` syntax is Node 24+, but the symbol method exists earlier.
      assert.equal(typeof doc[Symbol.dispose], "function");
      doc[Symbol.dispose]();
    } else {
      doc.dispose();
    }
  }
  assert.equal(doc.disposed, true);
});
