/**
 * Scrapling-style selection and adaptive relocation, on the WASM libxml2 parser.
 *
 * Transports are swappable: Electron `net` in Hypagon, a curl-impersonate binary
 * or plain `fetch` elsewhere. Parsing and relocation are identical everywhere.
 */
export { Page } from "./page.js";
export { Selector } from "./selector.js";

export {
  TreeIndex,
  similarityScore,
  dictDiff,
  relocate,
  findSimilar,
} from "./relocation/index.js";
export type {
  Fingerprint,
  FindSimilarOptions,
  RelocateResult,
} from "./relocation/index.js";

export { SequenceMatcher, ratio, pyRound2 } from "./relocation/difflib.js";

export { cssToXpath, CssSelectorError } from "./css/index.js";

export { cleanSpaces, cleanText, getAllText, findByText, findByRegex } from "./text/index.js";
export type {
  GetAllTextOptions,
  FindByTextOptions,
  FindByRegexOptions,
} from "./text/index.js";

export {
  ElectronNetTransport,
  createElectronNetTransport,
} from "./transport/electron.js";
export {
  CurlImpersonateTransport,
  curlImpersonateBinaryPath,
} from "./transport/curl-impersonate.js";
export type { CurlImpersonateOptions } from "./transport/curl-impersonate.js";
export { FetchTransport } from "./transport/fetch.js";
export type { HttpRequest, HttpResponse, Transport } from "./transport/types.js";
