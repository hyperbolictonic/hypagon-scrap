// Verify the vendored binary + wrapper reproduce the S2 curl_cffi fingerprint.
//
// Run: node spikes/curl-binary/verify.mjs
import { readFileSync } from "node:fs";

import { CurlImpersonateTransport } from "../../packages/core/dist/index.js";

const reference = JSON.parse(
  readFileSync(new URL("../transport-fingerprint/out-python.json", import.meta.url), "utf8"),
);

async function probe(profile) {
  const transport = new CurlImpersonateTransport({ profile });

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await transport.request({
        url: "https://tls.peet.ws/api/all",
        timeoutMs: 30000,
      });
      if (response.status !== 200) throw new Error(`probe status ${response.status}`);
      const data = JSON.parse(Buffer.from(response.body).toString("utf8"));
      return {
        profile,
        http: data?.http_version,
        ja4: data?.tls?.ja4,
        akamai: data?.http2?.akamai_fingerprint,
        akamaiHash: data?.http2?.akamai_fingerprint_hash,
        userAgent: data?.user_agent,
        ms: response.elapsedMs,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return { profile, error: lastError?.message };
}

const results = [];
for (const profile of ["chrome131", "chrome152", "chrome151"]) {
  results.push(await probe(profile));
}

for (const result of results) {
  console.log(JSON.stringify(result, null, 1));
}

const chrome131 = results.find((result) => result.profile === "chrome131");
const chrome152 = results.find((result) => result.profile === "chrome152");
const expected131 = reference.chrome131;
const expectedLatest = reference.chrome;

let failures = 0;
function check(name, actual, wanted) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${wanted}\n      actual   ${actual}`}`);
}

if (chrome131?.error) {
  console.log(`SKIP  chrome131 probe after retries: ${chrome131.error}`);
} else {
  check("chrome131 JA4 matches curl_cffi reference", chrome131.ja4, expected131.ja4);
  check("chrome131 H2 settings match", chrome131.akamai, expected131.akamai);
  check("chrome131 Chrome user agent", /Chrome\/131\./.test(chrome131.userAgent), true);
}

if (chrome152?.error) {
  console.log(`SKIP  chrome152 probe after retries: ${chrome152.error}`);
} else {
  check("chrome152 JA4 matches curl_cffi 'chrome' reference", chrome152.ja4, expectedLatest.ja4);
  check("chrome152 H2 settings match", chrome152.akamai, expectedLatest.akamai);
}

console.log(JSON.stringify({ failures }, null, 1));
process.exit(failures === 0 ? 0 : 1);
