#!/usr/bin/env node
// Fetch and verify the pinned curl-impersonate build.
//
// Supply chain rules:
//   - version, asset name and SHA-256 are constants here, not "latest"
//   - a downloaded artifact is hashed before extraction; mismatch deletes it
//   - nothing is executed until it has been verified
//
// Usage: node scripts/fetch-curl-impersonate.mjs [--force]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "2.3.2";
const BASE = `https://github.com/lexiforest/curl-impersonate/releases/download/v${VERSION}`;

/**
 * Hashes are GitHub's published `digest` values for the release assets, and the
 * win32-x64 value was independently reproduced locally.
 */
const TARGETS = {
  "win32-x64": {
    asset: `curl-impersonate-v${VERSION}.x86_64-win32.tar.gz`,
    sha256: "94affc91c64991552403d427cf0e6656ee74f85dcbe58c0ba389f540819f40db",
    exe: "curl-impersonate.exe",
  },
  "linux-x64": {
    asset: `curl-impersonate-v${VERSION}.x86_64-linux-gnu.tar.gz`,
    sha256: "bc9bd2522fe1850dd54c0fff189c8dd606df3f222ab2a905f2dd255123c3f495",
    exe: "curl-impersonate",
  },
  "linux-arm64": {
    asset: `curl-impersonate-v${VERSION}.aarch64-linux-gnu.tar.gz`,
    sha256: "35a351db883f5ce82945bd8280c727b08e27aa48594d4eb9e091d8c80e936d52",
    exe: "curl-impersonate",
  },
  "darwin-x64": {
    asset: `curl-impersonate-v${VERSION}.x86_64-macos.tar.gz`,
    sha256: "4e9fe855a34d011de88bf216c196f6957624526678b99b4f2135acc9ffa8c156",
    exe: "curl-impersonate",
  },
  "darwin-arm64": {
    asset: `curl-impersonate-v${VERSION}.arm64-macos.tar.gz`,
    sha256: "638ed43cc93cb5da91f794ff23fce1735fec3dc5c09ee87cc499d802c25d2d35",
    exe: "curl-impersonate",
  },
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  const body = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(destination, body);
  return body;
}

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    throw new Error(
      `No pinned curl-impersonate build for ${key}. ` +
        `Add one to TARGETS in scripts/fetch-curl-impersonate.mjs (version ${VERSION}).`,
    );
  }

  const installDir = path.join(root, "bin", key);
  const binaryPath = path.join(installDir, target.exe);
  const manifestPath = path.join(installDir, "manifest.json");

  if (!force && fs.existsSync(binaryPath) && fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (manifest.sha256 === target.sha256 && manifest.version === VERSION) {
      console.log(`already installed: ${binaryPath}`);
      return;
    }  }

  const cache = path.join(root, ".cache");
  await fsp.mkdir(cache, { recursive: true });
  const tarball = path.join(cache, target.asset);

  let ok = fs.existsSync(tarball);
  if (ok) {
    const actual = sha256(await fsp.readFile(tarball));
    if (actual !== target.sha256) {
      console.warn(`cached archive hash mismatch, re-downloading (${actual})`);
      await fsp.rm(tarball, { force: true });
      ok = false;
    }
  }

  if (!ok) {
    console.log(`downloading ${target.asset} ...`);
    const body = await download(`${BASE}/${target.asset}`, tarball);
    const actual = sha256(body);
    if (actual !== target.sha256) {
      await fsp.rm(tarball, { force: true });
      throw new Error(
        `SHA-256 mismatch for ${target.asset}\n  expected ${target.sha256}\n  actual   ${actual}`,
      );
    }
    console.log(`verified sha256 ${actual}`);
  }

  const extractDir = path.join(cache, `extract-${key}-${Date.now()}`);
  await fsp.mkdir(extractDir, { recursive: true });
  try {
    const tar = spawnSync("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error(`tar failed with exit ${tar.status}`);

    let extractedBinary = path.join(extractDir, target.exe);
    if (!fs.existsSync(extractedBinary)) {
      // Some archives nest everything in a top-level directory.
      const stack = [extractDir];
      while (stack.length > 0 && !fs.existsSync(extractedBinary)) {
        const current = stack.pop();
        for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name === target.exe) extractedBinary = full;
        }
      }
    }
    if (!fs.existsSync(extractedBinary)) {
      throw new Error(`${target.exe} not found in ${target.asset}`);
    }

    await fsp.mkdir(installDir, { recursive: true });
    await fsp.copyFile(extractedBinary, binaryPath);
    await fsp.chmod(binaryPath, 0o755);

    // Ship the upstream licences next to the binary.
    for (const entry of await fsp.readdir(extractDir)) {
      if (entry.startsWith("LICENSE")) {
        await fsp.copyFile(path.join(extractDir, entry), path.join(installDir, entry));
      }
    }

    await fsp.writeFile(
      manifestPath,
      JSON.stringify(
        {
          version: VERSION,
          target: key,
          asset: target.asset,
          sha256: target.sha256,
          binary: target.exe,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );

    console.log(`installed ${binaryPath}`);
  } finally {
    await fsp.rm(extractDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`fetch failed: ${error.message}`);
  process.exit(1);
});
