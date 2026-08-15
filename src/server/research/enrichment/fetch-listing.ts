import { isFetchableUrl, type UrlSafetyResult } from "./url-safety";

export type FetchResult =
  | { status: "ok"; html: string; finalUrl: string }
  | { status: "blocked"; reason: string }
  | { status: "error"; reason: string };

const DEFAULT_TIMEOUT_MS =
  Number(process.env.MARKET_RESEARCH_FETCH_TIMEOUT_MS) || 8_000;
// Plenty for JSON-LD/meta tags (what extract-price.ts actually reads), well
// short of a full SPA bundle — no reason to buffer more than this.
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_USER_AGENT = "Sellstice-MarketResearchBot/1.0 (comparable-price verification)";
const MAX_REDIRECTS = 3;

// Many marketplaces block/challenge server-side requests with a 200 OK
// challenge page (Cloudflare/PerimeterX/Akamai) rather than a 4xx, so status
// code alone isn't enough — the AI's discovery step already confirmed this
// is a real listing, so a challenge page here means "blocked", not "no
// listing found".
const CHALLENGE_SIGNATURES = [
  "captcha",
  "cf-browser-verification",
  "checking your browser",
  "access denied",
  "request unsuccessful",
  "perimeterx",
  "please verify you are a human",
  "pardon our interruption",
];

function looksLikeChallenge(html: string): boolean {
  const sample = html.slice(0, 5000).toLowerCase();
  return CHALLENGE_SIGNATURES.some((sig) => sample.includes(sig));
}

const BLOCKED_STATUS_CODES = new Set([401, 403, 429, 999]);

async function readBodyWithCap(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) {
    return response.text();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export interface FetchListingOptions {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /** Injectable for tests — production default is the real SSRF guard. */
  isUrlSafe?: (url: string) => Promise<UrlSafetyResult>;
}

/**
 * Fetches a single discovered listing URL server-side, for extract-price.ts
 * to parse. Single attempt — no silent retries, same "one billed/attempted
 * action" rationale as the AI providers (see AnthropicProvider). Every
 * hop of a redirect chain is re-checked against the SSRF guard before being
 * followed (redirect: "manual" + a bounded manual loop), since a hop to an
 * internal address would otherwise bypass a same-URL check done only once
 * up front.
 */
export async function fetchListingHtml(
  url: string,
  options: FetchListingOptions = {},
): Promise<FetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    userAgent = DEFAULT_USER_AGENT,
    isUrlSafe = isFetchableUrl,
  } = options;

  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safety = await isUrlSafe(currentUrl);
    if (!safety.safe) {
      return { status: "error", reason: `blocked by URL safety check: ${safety.reason}` };
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        signal,
        redirect: "manual",
        headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        return { status: "error", reason: "fetch timed out" };
      }
      return {
        status: "error",
        reason: `fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { status: "error", reason: `redirect (${response.status}) with no Location header` };
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (BLOCKED_STATUS_CODES.has(response.status)) {
      return { status: "blocked", reason: `HTTP ${response.status}` };
    }
    if (!response.ok) {
      return { status: "error", reason: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/html|text/i.test(contentType)) {
      return { status: "error", reason: `unexpected content-type ${contentType}` };
    }

    const html = await readBodyWithCap(response, maxBytes);
    if (html === null) {
      return { status: "error", reason: `response exceeded ${maxBytes} byte cap` };
    }
    if (looksLikeChallenge(html)) {
      return { status: "blocked", reason: "bot-challenge page detected" };
    }

    return { status: "ok", html, finalUrl: currentUrl };
  }

  return { status: "error", reason: "too many redirects" };
}
