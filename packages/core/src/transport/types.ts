/** A transport-agnostic HTTP request. */
export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Abort if no response arrives within this window. */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  /** Final URL after redirects, when the transport reports it. */
  url: string;
  elapsedMs: number;
}

/**
 * The swap point that makes this a swiss army knife.
 *
 * Implementations differ in fingerprint and cost, not in shape:
 * `ElectronNetTransport` (Chromium, Electron main process), a vendored
 * curl-impersonate binary (plain Node), or a real browser via patchright.
 */
export interface Transport {
  readonly name: string;
  request(request: HttpRequest): Promise<HttpResponse>;
  close(): Promise<void>;
}
