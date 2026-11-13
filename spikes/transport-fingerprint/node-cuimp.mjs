// S2 candidate A: cuimp — CLI wrapper around a lexiforest curl-impersonate binary.
import fs from "node:fs";
import { createCuimpHttp } from "cuimp";

const URL = "https://tls.peet.ws/api/all";
const TARGETS = [
  { browser: "chrome", version: "latest" },
  { browser: "chrome", version: "131" },
  { browser: "safari", version: "latest" },
  { browser: "firefox", version: "latest" },
];

const out = {};
for (const descriptor of TARGETS) {
  const key = `${descriptor.browser}-${descriptor.version}`;
  const t0 = Date.now();
  try {
    const client = createCuimpHttp({ descriptor });
    const res = await client.get(URL, { timeout: 30000 });
    const d = JSON.parse(res.rawBody.toString("utf8"));
    out[key] = {
      http_version: d.http_version,
      ja3_hash: d.tls?.ja3_hash ?? null,
      ja4: d.tls?.ja4 ?? null,
      akamai: d.http2?.akamai_fingerprint ?? null,
      akamai_hash: d.http2?.akamai_fingerprint_hash ?? null,
      user_agent: (d.user_agent || "").slice(0, 70),
      ms: Date.now() - t0,
      command: (res.request?.command || "").slice(0, 200),
    };
  } catch (e) {
    out[key] = { error: `${e.name}: ${e.message}`.slice(0, 200) };
  }
}

fs.writeFileSync("out-cuimp.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
