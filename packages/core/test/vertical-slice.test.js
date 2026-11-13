import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";

import { FetchTransport, Page } from "../dist/index.js";

/**
 * The P3+P4 vertical slice: fetch -> parse -> select -> fingerprint -> relocate.
 *
 * Uses the local `fetch` transport so the test needs no Electron and no binary;
 * the parsing/relocation path is identical to the Electron one.
 */
test("fetch -> parse -> select -> fingerprint -> relocate", async () => {
  const html = `<html><body><div class="products">
      <article class="product" id="p1"><h3>Widget</h3><span class="price">19.99</span></article>
      <article class="product" id="p2"><h3>Gadget</h3><span class="price">29.99</span></article>
    </div></body></html>`;

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const transport = new FetchTransport();
    const response = await transport.request({ url: `http://127.0.0.1:${port}/` });

    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /text\/html/);

    const page = await Page.load(new TextDecoder().decode(response.body));
    try {
      const [article] = page.xpath("//article[@id='p1']");
      assert.equal(article.tag, "article");
      assert.equal(article.attrs.id, "p1");

      const fingerprint = article.fingerprint();
      assert.equal(fingerprint.tag, "article");
      assert.deepEqual(fingerprint.path, ["html", "body", "div", "article"]);

      // The site drifts: extra class, the title wrapped, a new sibling inserted.
      const drifted = html
        .replace('class="product" id="p1"', 'class="product card" id="p1"')
        .replace("<h3>Widget</h3>", '<div class="title"><h3>Widget</h3></div>')
        .replace(
          '<article class="product" id="p2">',
          '<article class="product" id="p0"><h3>New</h3></article><article class="product" id="p2">',
        );

      const changed = await Page.load(drifted);
      try {
        const [relocated] = changed.relocate(fingerprint);
        assert.ok(relocated, "the element should be relocated after markup drift");
        assert.equal(relocated.attrs.id, "p1");

        // Structural siblings are still discoverable.
        assert.deepEqual(
          article.findSimilar().map((selector) => selector.attrs.id),
          ["p2"],
        );

        // A fingerprint is plain data, so it survives serialisation.
        const roundTripped = JSON.parse(JSON.stringify(fingerprint));
        assert.deepEqual(
          changed.relocate(roundTripped).map((selector) => selector.attrs.id),
          ["p1"],
        );
      } finally {
        changed.dispose();
      }
    } finally {
      page.dispose();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("honours the percentage threshold", async () => {
  const page = await Page.load(
    "<html><body><div><p class='a'>alpha</p></div></body></html>",
  );
  try {
    const [p] = page.xpath("//p");
    const fingerprint = p.fingerprint();

    const changed = await Page.load("<html><body><div><span>beta</span></div></body></html>");
    try {
      // This pair scores ~42%: same parent, similar path, different tag. It is
      // accepted at the default 40 — Scrapling behaves the same way.
      assert.equal(changed.relocate(fingerprint).length, 1);
      assert.equal(changed.relocate(fingerprint, 43).length, 0);
    } finally {
      changed.dispose();
    }
  } finally {
    page.dispose();
  }
});
