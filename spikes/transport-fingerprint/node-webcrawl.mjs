// S2 candidate B: @webcrawl/curl-impersonate — pinned lexiforest binary + own fetch layer.
import { setTimeout as sleep } from "node:timers/promises";
import { impersonateFetch, resolveBinary, ensureImpersonate } from "@webcrawl/curl-impersonate";

const URL = "https://tls.peet.ws/api/all";
const PROFILES = ["chrome152", "chrome150", "chrome142"];

const out = {};
// The binary is not fetched lazily on first use — it must be ensured explicitly,
// otherwise every call throws ImpersonateUnavailableError.
out._ensure = await ensureImpersonate().catch((e) => `error: ${e.message}`);
out._binary = await resolveBinary().catch((e) => `error: ${e.message}`);

for (const profile of PROFILES) {
  let row = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await impersonateFetch(URL, { profile, timeoutMs: 30000 });
      const d = JSON.parse(Buffer.from(res.body).toString("utf8"));
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
  out[profile] = row;
  await sleep(1500);
}

console.log(JSON.stringify(out, null, 1));
