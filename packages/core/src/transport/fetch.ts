import type { HttpRequest, HttpResponse, Transport } from "./types.js";

/**
 * Plain `fetch`.
 *
 * **Not fingerprint-mimicking**: it uses Node's own TLS stack, so it is for
 * local servers, tests and internal endpoints — not for protected sites. The
 * stealthy routes are Electron `net` and the curl-impersonate binary.
 */
export class FetchTransport implements Transport {
  readonly name = "fetch";

  async request(request: HttpRequest): Promise<HttpResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = request.timeoutMs
      ? setTimeout(() => controller.abort(), request.timeoutMs)
      : undefined;

    try {
      const response = await fetch(request.url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body as any,
        signal: controller.signal,
        redirect: "follow",
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });

      return {
        status: response.status,
        headers,
        body: new Uint8Array(await response.arrayBuffer()),
        url: response.url,
        elapsedMs: Date.now() - started,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    // Nothing to release: fetch uses the shared global agent.
  }
}
