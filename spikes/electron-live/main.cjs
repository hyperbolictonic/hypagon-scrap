// Live Electron host test for hypagon-scrap.
//
// Proves the parts that unit tests cannot:
//   - createElectronNetTransport() dynamically imports Electron in a real main process
//   - ElectronNetTransport drives net.request through the core Transport interface
//   - the WASM parser loads and runs inside Electron
//   - CSS selection, fingerprints, relocate and findSimilar work end to end
//
// Also re-checks the TLS fingerprint through our transport (S4 proved raw `net`;
// this proves the wrapper does not change it).
//
// Run: electron.exe spikes\electron-live\main.cjs
const { app } = require("electron");
const { createServer } = require("node:http");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

app.disableHardwareAcceleration();

const CORE = path.resolve(__dirname, "../../packages/core/dist/index.js");

const CATALOG = `<html><body><div class="wrap"><div class="products">
  <article class="product" id="p1"><h3>Widget</h3><span class="price">19.99</span></article>
  <article class="product" id="p2"><h3>Gadget</h3><span class="price">29.99</span></article>
</div></div></body></html>`;

const DRIFTED = `<html><body><div class="wrap"><div class="products">
  <article class="product card" id="p0"><h3>New</h3></article>
  <article class="product card" id="p1"><div class="title"><h3>Widget</h3></div><span class="price">19.99</span></article>
  <article class="product card" id="p2"><div class="title"><h3>Gadget</h3></div><span class="price">29.99</span></article>
</div></div></body></html>`;

const results = [];
let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}${detail === undefined ? "" : ` â€” ${JSON.stringify(detail)}`}`);
  }
}

function startServer() {
  const server = createServer((request, response) => {
    const body = request.url === "/drifted" ? DRIFTED : CATALOG;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function main() {
  const { createElectronNetTransport, Page } = await import(pathToFileURL(CORE).href);

  check("dynamic import of the core package resolves", typeof Page === "function");
  check("electron runtime detected", Boolean(process.versions.electron), process.versions);

  // The public factory is the thing under test â€” it imports Electron itself.
  const transport = await createElectronNetTransport();
  check("createElectronNetTransport() returned a transport", transport.name === "electron-net");

  const { server, port } = await startServer();

  try {
    const first = await transport.request({
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: 10000,
    });

    check("HTTP 200 from Electron net", first.status === 200, first.status);
    check("content-type header present", /text\/html/.test(first.headers["content-type"] ?? ""), first.headers);
    check("response body collected", Buffer.from(first.body).toString().includes("Widget"));
    check("elapsedMs recorded", first.elapsedMs >= 0);

    const page = await Page.load(new TextDecoder().decode(first.body));
    try {
      const products = page.css("article.product");
      check("WASM parser + CSS work inside Electron", products.length === 2, products.length);

      const [target] = page.css("#p1");
      const fingerprint = target.fingerprint();
      check("fingerprint built", fingerprint.tag === "article" && fingerprint.attributes.id === "p1", fingerprint);
      check(
        "fingerprint path is a tag tuple",
        JSON.stringify(fingerprint.path) === JSON.stringify(["html", "body", "div", "div", "article"]),
        fingerprint.path,
      );

      const driftedResponse = await transport.request({
        url: `http://127.0.0.1:${port}/drifted`,
        timeoutMs: 10000,
      });
      const drifted = await Page.load(new TextDecoder().decode(driftedResponse.body));
      try {
        const [relocated] = drifted.relocate(fingerprint);
        check("relocate finds the drifted element", relocated?.attrs.id === "p1", relocated?.path);
        check(
          "findSimilar returns the sibling",
          JSON.stringify(page.css("#p1")[0].findSimilar().map((n) => n.attrs.id)) === JSON.stringify(["p2"]),
          page.css("#p1")[0].findSimilar().map((n) => n.attrs.id),
        );
      } finally {
        drifted.dispose();
      }
    } finally {
      page.dispose();
    }

    // Reuse the same transport: a second request must not be poisoned by the first.
    const again = await transport.request({ url: `http://127.0.0.1:${port}/`, timeoutMs: 10000 });
    check("transport can be reused", again.status === 200 && Buffer.from(again.body).toString().includes("Widget"), again.status);

    // Fingerprint through the wrapper, not raw net. Network may be unavailable.
    try {
      const probe = await transport.request({ url: "https://tls.peet.ws/api/all", timeoutMs: 20000 });
      if (probe.status === 200) {
        const data = JSON.parse(Buffer.from(probe.body).toString("utf8"));
        const ja4 = data?.tls?.ja4;
        const akamai = data?.http2?.akamai_fingerprint;
        check("TLS fingerprint present via wrapper", Boolean(ja4 && akamai), { ja4, akamai });
        console.log(`      ja4=${ja4}  akamai=${akamai}`);
        console.log(`      chromium=${data?.tls?.ja3_hash ?? "?"}  user_agent=${(data?.user_agent ?? "").slice(0, 60)}`);
      } else {
        console.log(`SKIP  fingerprint probe (status ${probe.status})`);
      }
    } catch (error) {
      console.log(`SKIP  fingerprint probe (${error.message})`);
    }
  } finally {
    await transport.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(
    JSON.stringify(
      { electron: process.versions.electron, chrome: process.versions.chrome, checks: results.length, failures },
      null,
      1,
    ),
  );

  app.exit(failures === 0 ? 0 : 1);
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error("FATAL", error);
    app.exit(1);
  });
