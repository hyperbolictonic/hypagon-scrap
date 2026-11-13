// S3: what does the dynamic (Chromium) path actually cost?
// Measures cold launch, warm navigation, RSS delta of the browser process set,
// and — as a bonus — the fingerprint a real browser emits.
//
// RSS is a system-wide delta across browser processes rather than the launched
// tree, because patchright does not expose the browser PID. Close other
// browsers before trusting the absolute number.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "patchright";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = "https://tls.peet.ws/api/all";
const NAVS = 3;

function browserRssMb() {
  try {
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "rss.ps1")],
      { encoding: "utf8" },
    );
    return Math.round(Number(out.trim())) || null;
  } catch {
    return null;
  }
}

const out = {};
out.rssBeforeMb = browserRssMb();

const t0 = Date.now();
const browser = await chromium.launch({ headless: true });
out.coldLaunchMs = Date.now() - t0;

const context = await browser.newContext();
const page = await context.newPage();

out.navMs = [];
for (let i = 0; i < NAVS; i++) {
  const t = Date.now();
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    out.navMs.push(Date.now() - t);
  } catch (e) {
    out.navMs.push(`err:${e.name}`);
  }
  if (i === 0) {
    try {
      const d = JSON.parse(await page.locator("body").innerText());
      out.fingerprint = {
        http_version: d.http_version,
        ja3_hash: d.tls?.ja3_hash ?? null,
        ja4: d.tls?.ja4 ?? null,
        akamai_hash: d.http2?.akamai_fingerprint_hash ?? null,
        user_agent: (d.user_agent || "").slice(0, 80),
      };
    } catch (e) {
      out.fingerprint = { error: `${e.name}: ${e.message}`.slice(0, 120) };
    }
  }
}

out.rssAfterMb = browserRssMb();
out.rssDeltaMb =
  out.rssBeforeMb != null && out.rssAfterMb != null ? out.rssAfterMb - out.rssBeforeMb : null;

// Throughput sanity: how fast can it pull a real page?
const t1 = Date.now();
try {
  await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 45000 });
  out.exampleComMs = Date.now() - t1;
  out.exampleTitle = await page.title();
} catch (e) {
  out.exampleComMs = `err:${e.name}`;
}

await browser.close();
out.totalMs = Date.now() - t0;

const navs = out.navMs.filter((n) => typeof n === "number").sort((a, b) => a - b);
out.navMedianMs = navs.length ? navs[Math.floor(navs.length / 2)] : null;

console.log(JSON.stringify(out, null, 1));
