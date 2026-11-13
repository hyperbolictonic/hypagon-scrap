// Packaging gate: pack both packages, install the tarballs into a clean project,
// and run the library. This catches the failures a workspace build hides —
// missing artifacts, bad `files` entries, broken exports.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);

function run(args, cwd) {
  // One command string avoids Node's DEP0190 (shell + args array); every value
  // is quoted because os.tmpdir() can contain spaces.
  const result = spawnSync(`npm ${args.map(quote).join(" ")}`, {
    cwd,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed (exit ${result.status})`);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "hypagon-scrap-pack-"));

try {
  console.log(`packing into ${work}`);
  run(["pack", "-w", "hypagon-scrap-libxml2", "--pack-destination", work], root);
  run(["pack", "-w", "hypagon-scrap", "--pack-destination", work], root);

  const tarballs = fs
    .readdirSync(work)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => `./${name}`);

  console.log(`tarballs: ${tarballs.join(", ")}`);

  fs.writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify({ name: "pack-check", private: true, type: "module" }, null, 2),
  );

  run(["install", ...tarballs, "--no-audit", "--no-fund"], work);

  fs.writeFileSync(
    path.join(work, "smoke.mjs"),
    `import { Page } from "hypagon-scrap";

const page = await Page.load(
  "<html><body><div class='products'><article class='product' id='p1'><h3>Widget</h3><span class='price'>19.99</span></article></div></body></html>",
);
const [article] = page.css("article.product");
if (!article || article.attrs.id !== "p1") throw new Error("css selection failed");
if (article.text !== "") throw new Error("own text should be empty");

const fingerprint = article.fingerprint();
if (fingerprint.tag !== "article") throw new Error("fingerprint failed");

const drifted = await Page.load(
  "<html><body><div class='products'><article class='product card' id='p1'><div class='t'><h3>Widget</h3></div></article></div></body></html>",
);
const [relocated] = drifted.relocate(fingerprint);
if (!relocated || relocated.attrs.id !== "p1") throw new Error("relocation failed");

drifted.dispose();
page.dispose();
console.log("pack-check smoke: OK");
`,
  );

  const smoke = spawnSync(process.execPath, ["smoke.mjs"], {
    cwd: work,
    stdio: "inherit",
  });
  if (smoke.status !== 0) {
    throw new Error(`smoke test failed (exit ${smoke.status})`);
  }
  console.log("pack-check: PASS");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
