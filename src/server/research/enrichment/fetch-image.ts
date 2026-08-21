import { isFetchableUrl, type UrlSafetyResult } from "./url-safety";
import { MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES } from "@/server/storage/image-validation";

type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export type ImageFetchResult =
  | { status: "ok"; base64: string; mediaType: AllowedImageType }
  | { status: "blocked"; reason: string }
  | { status: "error"; reason: string };

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = MAX_IMAGE_BYTES;
const DEFAULT_USER_AGENT = "Sellstice-MarketResearchBot/1.0 (comparable-image verification)";
const MAX_REDIRECTS = 3;

async function readBytesWithCap(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    return arrayBuffer.byteLength > maxBytes ? null : Buffer.from(arrayBuffer);
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
  return Buffer.concat(chunks);
}

/**
 * Sniffs the actual file signature rather than trusting the URL's extension
 * or a claimed Content-Type header — unlike an uploaded photo (trusted
 * because it's the user's own upload, see validateImageFile), bytes fetched
 * from a third-party marketplace listing are untrusted and deserve the
 * stronger check.
 */
function sniffImageMediaType(bytes: Buffer): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export interface FetchImageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /** Injectable for tests — production default is the real SSRF guard. */
  isUrlSafe?: (url: string) => Promise<UrlSafetyResult>;
}

/**
 * Fetches and validates a single candidate listing image server-side, for
 * discovery/match-candidates-visual.ts to compare against the seller's own
 * photos. Same safety posture as fetch-listing.ts: every redirect hop is
 * re-checked against the SSRF guard (redirect: "manual" + a bounded manual
 * loop), single attempt with no silent retries. Bounded by size and, unlike
 * a listing page, also validated by real magic bytes rather than a trusted
 * Content-Type header.
 */
export async function fetchListingImage(
  url: string,
  options: FetchImageOptions = {},
): Promise<ImageFetchResult> {
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
        headers: { "User-Agent": userAgent, Accept: "image/*" },
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

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return { status: "blocked", reason: `HTTP ${response.status}` };
    }
    if (!response.ok) {
      return { status: "error", reason: `HTTP ${response.status}` };
    }

    const bytes = await readBytesWithCap(response, maxBytes);
    if (bytes === null) {
      return { status: "error", reason: `response exceeded ${maxBytes} byte cap` };
    }

    const mediaType = sniffImageMediaType(bytes);
    if (mediaType === null) {
      return { status: "error", reason: "response is not a recognized image format" };
    }

    return { status: "ok", base64: bytes.toString("base64"), mediaType };
  }

  return { status: "error", reason: "too many redirects" };
}
