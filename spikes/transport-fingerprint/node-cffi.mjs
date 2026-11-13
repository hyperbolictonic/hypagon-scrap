// S2 candidate C: curl-cffi-node — napi binding to libcurl-8.15.0-IMPERSONATE (BoringSSL).
// Structurally the closest analogue to Python's curl_cffi.
import { setTimeout as sleep } from "node:timers/promises";
import * as cffi from "curl-cffi-node";

const URL = "https://tls.peet.ws/api/all";
const TARGETS = ["chrome131", "chrome124", "safari18_0"];

const out = { _curl: cffi.curlVersion(), _native: cffi.nativeVersion() };

for (const target of TARGETS) {
  let row = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await cffi.get(URL, { impersonate: target, timeout: 30 });
      const d = JSON.parse(res.content.toString("utf8"));
      row = {
        http_version: d.http_version,
        ja3_hash: d.tls?.ja3_hash ?? null,
        ja4: d.tls?.ja4 ?? null,
        akamai_hash: d.http2?.akamai_fingerprint_hash ?? null,
        user_agent: (d.user_agent || "").slice(0, 70),
        ms: Date.now() - t0,
        status: res.status,
      };
      break;
    } catch (e) {
      row = { error: `${e.name}: ${e.message}`.slice(0, 140), attempt };
      await sleep(2500 * attempt);
    }
  }
  out[target] = row;
  await sleep(1500);
}

console.log(JSON.stringify(out, null, 1));
