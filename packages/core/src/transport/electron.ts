import type { HttpRequest, HttpResponse, Transport } from "./types.js";

/**
 * The sliver of Electron's `net` API this transport depends on.
 *
 * Declared structurally so the transport can be unit-tested with a fake and so
 * this module never imports `electron` at load time.
 */
export interface ElectronRequestLike {
  on(event: string, listener: (...args: any[]) => void): this;
  setHeader(name: string, value: string): void;
  write(chunk: string | Uint8Array): void;
  end(): void;
  abort(): void;
}

export interface ElectronResponseLike {
  statusCode: number;
  headers: Record<string, string | string[]>;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface ElectronNetLike {
  request(options: Record<string, unknown>): ElectronRequestLike;
}

function toBytes(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/**
 * Chromium's network stack via Electron's `net` module.
 *
 * Main process only, after `app.whenReady()`. Emits a genuine Chromium
 * fingerprint (S4), needs no binary and no CA bundle — which is why it is the
 * first transport built for Hypagon.
 */
export class ElectronNetTransport implements Transport {
  readonly name = "electron-net";

  readonly #net: ElectronNetLike;
  readonly #session: unknown;

  constructor(net: ElectronNetLike, session?: unknown) {
    this.#net = net;
    this.#session = session;
  }

  request(request: HttpRequest): Promise<HttpResponse> {
    const started = Date.now();

    return new Promise<HttpResponse>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        action();
      };

      const options: Record<string, unknown> = {
        method: request.method ?? "GET",
        url: request.url,
      };
      if (this.#session !== undefined) options.session = this.#session;

      let client: ElectronRequestLike;
      try {
        client = this.#net.request(options);
      } catch (error) {
        settle(() => reject(error));
        return;
      }

      for (const [name, value] of Object.entries(request.headers ?? {})) {
        client.setHeader(name, value);
      }

      if (request.timeoutMs && request.timeoutMs > 0) {
        const timeoutMs = request.timeoutMs;
        timer = setTimeout(() => {
          settle(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)));
          client.abort();
        }, timeoutMs);
      }

      client.on("error", (error: Error) => settle(() => reject(error)));

      client.on("response", (response: ElectronResponseLike) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: string | Uint8Array) => chunks.push(toBytes(chunk)));
        response.on("error", (error: Error) => settle(() => reject(error)));
        response.on("end", () =>
          settle(() =>
            resolve({
              status: response.statusCode,
              headers: flattenHeaders(response.headers),
              body: concat(chunks),
              url: request.url,
              elapsedMs: Date.now() - started,
            }),
          ),
        );
      });

      if (request.body !== undefined) client.write(request.body);
      client.end();
    });
  }

  async close(): Promise<void> {
    // Electron owns the network stack; there is nothing per-transport to release.
  }
}

/**
 * Loads Electron and returns a transport bound to its `net` module.
 *
 * Fails with a clear message outside Electron rather than a bare
 * MODULE_NOT_FOUND, so the error says what to do instead.
 */
export async function createElectronNetTransport(
  options: { session?: unknown } = {},
): Promise<ElectronNetTransport> {
  const specifier = "electron";

  let electron: any;
  try {
    // Non-literal specifier: keeps TypeScript from requiring electron's types
    // and keeps the import out of the plain-Node dependency graph.
    electron = await import(specifier);
  } catch (cause) {
    throw new Error(
      "Electron is not available. Use createElectronNetTransport() only in Electron's main process; in plain Node use another transport.",
      { cause },
    );
  }

  const { app, net } = electron ?? {};
  if (app && typeof app.whenReady === "function") await app.whenReady();
  if (!net || typeof net.request !== "function") {
    throw new Error("Electron's net module is unavailable");
  }

  return new ElectronNetTransport(net as ElectronNetLike, options.session);
}
