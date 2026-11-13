// Per-request cost: subprocess-per-request (cuimp) vs in-process (curl-cffi-node).
// Both are correct on the fingerprint; this decides which one is usable at crawl scale.
import { setTimeout as sleep } from "node:timers/promises";
import { createCuimpHttp } from "cuimp";
import * as cffi from "curl-cffi-node";

const URL = "https://tls.peet.ws/api/all";
const N = 5;

async function bench(name, fn) {
  const times = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    try {
      await fn();
      times.push(Math.round(performance.now() - t0));
    } catch (e) {
      times.push(`err:${e.name}`);
      break;
    }
    await sleep(800);
  }
  const nums = times.filter((t) => typeof t === "number").sort((a, b) => a - b);
  return {
    name,
    runs: times,
    medianMs: nums.length ? nums[Math.floor(nums.length / 2)] : null,
    minMs: nums[0] ?? null,
  };
}

const cuimpClient = createCuimpHttp({ descriptor: { browser: "chrome", version: "latest" } });

const out = [];
out.push(await bench("cuimp — spawn per request", () => cuimpClient.get(URL, { timeout: 30000 })));
out.push(
  await bench("curl-cffi-node — in-process", () =>
    cffi.get(URL, { impersonate: "chrome131", timeout: 30, verify: false }),
  ),
);

console.log(JSON.stringify(out, null, 1));
