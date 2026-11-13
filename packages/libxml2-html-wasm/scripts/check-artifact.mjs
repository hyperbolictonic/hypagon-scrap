// Prepack guard: never publish a parser package without its WASM artifact.
//
// `build/` is committed so a clean clone can pack, but a stale or empty
// artifact is worse than a failed publish. This turns that into a clear error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = ["build/hx.mjs", "build/hx.wasm"];

const problems = [];
for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) problems.push(`${relative}: missing`);
  else if (fs.statSync(full).size === 0) problems.push(`${relative}: empty`);
}

if (problems.length > 0) {
  console.error("WASM artifact check failed:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("Run `npm run build:wasm` in this package before packing.");
  process.exit(1);
}

const size = fs.statSync(path.join(root, "build/hx.wasm")).size;
console.log(`WASM artifact OK (hx.wasm ${Math.round(size / 1024)} KB)`);
