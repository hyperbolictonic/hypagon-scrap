import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HttpRequest, HttpResponse, Transport } from "./types.js";

export interface CurlImpersonateOptions {
  /** Explicit binary path. Falls back to CURL_IMPERSONATE_BIN, then the vendored build. */
  binaryPath?: string;
  /**
   * Impersonation target, e.g. `chrome131`, `chrome151`, `firefox147`.
   * `chrome` alone is not a valid target in this build.
   */
  profile?: string;
  /** Optional CA bundle passed as `--cacert`. This build already has NativeCA. */
  caBundle?: string;
  maxRedirects?: number;
}

/** Where the fetch script installs the pinned build. */
export function curlImpersonateBinaryPath(): string {
  const key = `${process.platform}-${process.arch}`;
  const exe = process.platform === "win32" ? "curl-impersonate.exe" : "curl-impersonate";
  return fileURLToPath(new URL(`../../bin/${key}/${exe}`, import.meta.url));
}

function run(
  binary: string,
  args: readonly string[],
  killAfterMs: number | undefined,
): Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(binary, args as string[], { windowsHide: true });

    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: {
      code: number | null;
      stdout: string;
      stderr: string;
      spawnError?: Error;
    }): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({ code: null, stdout, stderr, spawnError: error }));
    child.on("close", (code) => finish({ code, stdout, stderr }));

    if (killAfterMs !== undefined && killAfterMs > 0) {
      timer = setTimeout(() => {
        child.kill();
        finish({
          code: null,
          stdout,
          stderr,
          spawnError: new Error(`process did not exit within ${killAfterMs}ms`),
        });
      }, killAfterMs);
    }
  });
}

function parseHeaders(raw: string): Record<string, string> {
  // With -L, the dump contains one block per hop; the last block is the final
  // response.
  const blocks = raw.split(/\r?\n\r?\n/).filter((block) => block.trim() !== "");
  const block = blocks[blocks.length - 1];
  if (!block) return {};

  const lines = block.split(/\r?\n/);
  lines.shift(); // status line

  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/**
 * curl-impersonate as a subprocess — the plain-Node route.
 *
 * Pinned to the build fetched by `npm run fetch:curl`, which verifies the
 * release SHA-256 before installing. One process per request: simple, isolated,
 * and honest about its cost.
 */
export class CurlImpersonateTransport implements Transport {
  readonly name = "curl-impersonate";
  readonly profile: string;

  readonly #binaryPath: string;
  readonly #caBundle: string | undefined;
  readonly #maxRedirects: number;

  constructor(options: CurlImpersonateOptions = {}) {
    this.#binaryPath =
      options.binaryPath ?? process.env.CURL_IMPERSONATE_BIN ?? curlImpersonateBinaryPath();
    this.profile = options.profile ?? process.env.CURL_IMPERSONATE_PROFILE ?? "chrome131";
    this.#caBundle = options.caBundle;
    this.#maxRedirects = options.maxRedirects ?? 10;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "curl-impersonate-"));
    const headerFile = path.join(workDir, "headers.txt");
    const bodyFile = path.join(workDir, "body.bin");
    const postFile = path.join(workDir, "post.bin");

    try {
      const args: string[] = [
        "--impersonate",
        this.profile,
        "-sS",
        "--compressed",
        "-L",
        "--max-redirs",
        String(this.#maxRedirects),
        "-D",
        headerFile,
        "-o",
        bodyFile,
        "-w",
        "%{http_code}\n%{url_effective}",
      ];

      if (request.timeoutMs && request.timeoutMs > 0) {
        args.push("--max-time", (request.timeoutMs / 1000).toFixed(3));
      }
      if (this.#caBundle) {
        args.push("--cacert", this.#caBundle);
      }

      for (const [name, value] of Object.entries(request.headers ?? {})) {
        if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
          throw new Error(`Invalid header for curl: ${name}`);
        }
        args.push("-H", `${name}: ${value}`);
      }

      const method = (request.method ?? "GET").toUpperCase();
      if (method === "HEAD") {
        args.push("-I");
      } else if (method !== "GET") {
        args.push("-X", method);
      }

      if (request.body !== undefined) {
        await writeFile(postFile, request.body);
        args.push("--data-binary", `@${postFile}`);
      }

      args.push("--url", request.url);

      const started = Date.now();
      const result = await run(
        this.#binaryPath,
        args,
        request.timeoutMs ? request.timeoutMs + 5000 : undefined,
      );
      const elapsedMs = Date.now() - started;

      if (result.spawnError) {
        const missing = (result.spawnError as NodeJS.ErrnoException).code === "ENOENT";
        throw new Error(
          missing
            ? `curl-impersonate binary not found at ${this.#binaryPath}. Run \`npx hypagon-scrap-fetch-curl\` (or \`npm run fetch:curl\` in the repo).`
            : result.spawnError.message,
        );
      }
      if (result.code !== 0) {
        throw new Error(
          `curl-impersonate exited with ${result.code}: ${result.stderr.trim() || "no stderr"}`,
        );
      }

      const [statusText = "", effectiveUrl = ""] = result.stdout.trim().split(/\r?\n/);
      const status = Number(statusText);
      if (!Number.isFinite(status) || status <= 0) {
        throw new Error(`curl-impersonate returned no status (stdout: ${result.stdout.slice(0, 120)})`);
      }

      const headerText = await readFile(headerFile, "utf8").catch(() => "");
      // `-I` writes HEAD's response headers into the output file, not a body.
      const body =
        method === "HEAD"
          ? Buffer.alloc(0)
          : await readFile(bodyFile).catch(() => Buffer.alloc(0));

      return {
        status,
        headers: parseHeaders(headerText),
        body: new Uint8Array(body),
        url: effectiveUrl.trim() || request.url,
        elapsedMs,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    // Each request owns its process; nothing is pooled.
  }
}
