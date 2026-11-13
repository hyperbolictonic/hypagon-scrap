// S4: does Electron's net module emit a genuine Chromium-family TLS/H2 fingerprint?
//
// net.request goes through Chromium's network service, not Node's — so if the
// fingerprint matches a real Chrome, an Electron host (Hypagon) needs no vendored
// binary at all.
const { app, net } = require("electron");

const URL = "https://tls.peet.ws/api/all";

function fetchViaNet() {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: "GET", url: URL, useSessionCookies: false });
    let body = "";
    req.on("response", (res) => {
      res.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

function summarize(d) {
  return {
    http_version: d.http_version,
    ja3_hash: d.tls?.ja3_hash ?? null,
    ja4: d.tls?.ja4 ?? null,
    akamai: d.http2?.akamai_fingerprint ?? null,
    akamai_hash: d.http2?.akamai_fingerprint_hash ?? null,
    user_agent: (d.user_agent || "").slice(0, 80),
  };
}

app.whenReady().then(async () => {
  const meta = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform}/${process.arch}`,
  };

  const out = { _meta: meta, runs: [] };
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      const res = await fetchViaNet();
      const d = JSON.parse(res.body);
      out.runs.push({ run: i + 1, status: res.status, ms: Date.now() - t0, ...summarize(d) });
    } catch (e) {
      out.runs.push({ run: i + 1, error: `${e.name}: ${e.message}`.slice(0, 160) });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  const ja4 = new Set(out.runs.map((r) => r.ja4).filter(Boolean));
  const akamai = new Set(out.runs.map((r) => r.akamai_hash).filter(Boolean));
  out.stable = { ja4Variants: ja4.size, akamaiVariants: akamai.size };

  console.log(JSON.stringify(out, null, 1));
  app.quit();
});
