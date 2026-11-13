import { test } from "node:test";
import assert from "node:assert/strict";

import { HtmlDocument, parseHtml } from "../dist/index.js";

test("parses elements, attributes, paths and both text views", async () => {
  const doc = await HtmlDocument.parse(
    "<html><body><div class='a b' id='x'>lead<span>inner</span>tail</div></body></html>",
  );
  try {
    assert.equal(doc.root.name, "html");

    const [div] = doc.xpath("//div");
    assert.equal(div.name, "div");
    assert.deepEqual(div.attrs, { class: "a b", id: "x" });
    assert.equal(div.path, "/html/body/div");

    // ownText is lxml's .text (before the first child element)
    assert.equal(div.ownText, "lead");
    // text is the deep content
    assert.equal(div.text, "leadinnertail");

    const [span] = div.xpath(".//span");
    assert.equal(span.ownText, "inner");
    assert.equal(span.parent.name, "div");
  } finally {
    doc.dispose();
  }
});

test("keeps whitespace-only text like lxml does", async () => {
  const doc = await HtmlDocument.parse("<html><body><div class='a'>   </div></body></html>");
  try {
    const [div] = doc.xpath("//div");
    // Scrapling passes remove_blank_text=True, but libxml2's HTML parser does not
    // apply it to `.text` — verified against Scrapling 0.5.1. Matching the
    // reference means keeping the whitespace, not "fixing" it.
    assert.equal(div.ownText, "   ");
    assert.deepEqual(div.childNodes.map((n) => n.typeName), ["text"]);
    // element_to_dict then strips, so relocation still sees an empty string.
    assert.equal(div.ownText.trim(), "");
  } finally {
    doc.dispose();
  }
});

test("drops comments by default and keeps them on request", async () => {
  const html = "<html><body><div><!-- note --><span>x</span></div></body></html>";

  const dropped = await HtmlDocument.parse(html);
  try {
    const [div] = dropped.xpath("//div");
    assert.deepEqual(div.childNodes.map((n) => n.typeName), ["element"]);
  } finally {
    dropped.dispose();
  }

  const kept = await HtmlDocument.parse(html, { dropComments: false });
  try {
    const [div] = kept.xpath("//div");
    assert.deepEqual(div.childNodes.map((n) => n.typeName), ["comment", "element"]);
  } finally {
    kept.dispose();
  }
});

test("element xpath is scoped to the element", async () => {
  const doc = await HtmlDocument.parse(
    "<html><body><div id='a'><em>one</em><p><em>two</em></p></div><div id='b'><em>three</em></div></body></html>",
  );
  try {
    const [a] = doc.xpath("//div[@id='a']");
    assert.equal(a.xpath(".//em").length, 2);
    assert.equal(a.xpath(".//em")[0].ownText, "one");
    // document-scoped still sees everything
    assert.equal(doc.xpath("//em").length, 3);
  } finally {
    doc.dispose();
  }
});

test("recovers malformed markup", async () => {
  const doc = await HtmlDocument.parse("<div><p>one<p>two");
  try {
    assert.equal(doc.xpath("//p").length, 2);
    assert.equal(doc.xpath("//p")[1].ownText, "two");
  } finally {
    doc.dispose();
  }
});

test("round-trips non-ASCII text", async () => {
  const doc = await parseHtml("<html><body><p>日本語 — naïve</p></body></html>");
  try {
    const [p] = doc.xpath("//p");
    assert.equal(p.ownText, "日本語 — naïve");
  } finally {
    doc.dispose();
  }
});
