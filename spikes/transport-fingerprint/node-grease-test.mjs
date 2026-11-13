// Is chrome's JA3 hash instability GREASE, or a genuine fingerprint difference?
// Chrome randomises GREASE values per connection, so JA3 (computed on the raw
// ClientHello) must vary run-to-run while JA4 (GREASE-normalised) stays fixed.
import { setTimeout as sleep } from "node:timers/promises";
import { createCuimpHttp } from "cuimp";

const client = createCuimpHttp({ descriptor: { browser: "chrome", version: "latest" } });

async function once() {
  const res = await client.get("https://tls.peet.ws/api/all", { timeout: 30000 });
  const d = JSON.parse(res.rawBody.toString("utf8"));
  return { ja3: d.tls?.ja3_hash, ja4: d.tls?.ja4, akamai: d.http2?.akamai_fingerprint_hash };
}

const rows = [];
for (let i = 0; i < 4; i++) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      rows.push({ run: i + 1, attempt, ...(await once()) });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = `${e.name}: ${e.message}`.slice(0, 90);
      await sleep(2500 * attempt);
    }
  }
  if (lastErr) rows.push({ run: i + 1, error: lastErr });
  await sleep(1500);
}

const ok = rows.filter((r) => !r.error);
const uniq = (k) => new Set(ok.map((r) => r[k])).size;
console.log(JSON.stringify(rows, null, 1));
console.log(`\nok runs=${ok.length}  distinct: ja3=${uniq("ja3")} ja4=${uniq("ja4")} akamai=${uniq("akamai")}`);
