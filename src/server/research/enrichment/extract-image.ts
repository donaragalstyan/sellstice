import {
  extractJsonLdBlocks,
  flattenJsonLdNodes,
  findMetaContent,
  isProductNode,
} from "./extract-price";

// --- Strategy 1: JSON-LD (schema.org Product.image) ------------------------

function firstImageUrl(image: unknown): string | null {
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const entry of image) {
      const url = firstImageUrl(entry);
      if (url !== null) return url;
    }
    return null;
  }
  if (image && typeof image === "object") {
    const url = (image as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return null;
}

function extractFromJsonLd(html: string): string | null {
  const nodes = flattenJsonLdNodes(extractJsonLdBlocks(html));
  for (const node of nodes) {
    if (!isProductNode(node)) continue;
    const url = firstImageUrl(node.image);
    if (url !== null) return url;
  }
  return null;
}

// --- Strategy 2: Open Graph image meta tag ----------------------------------

function extractFromMetaTags(html: string): string | null {
  // Two separate lookups, not one call with both keys — findMetaContent
  // matches in document order across whatever keys it's given, it doesn't
  // prioritize by the keys array's own order.
  return findMetaContent(html, ["og:image:secure_url"]) ?? findMetaContent(html, ["og:image"]);
}

// --- Entry point -------------------------------------------------------------

const STRATEGIES: Array<(html: string) => string | null> = [extractFromJsonLd, extractFromMetaTags];

/**
 * Deterministic, network-free image-URL extraction from a listing page
 * already fetched for price verification (enrichment/extract-price.ts) — no
 * extra request. Same trust-tiered strategy pattern: structured data first,
 * then Open Graph meta tags. Resolves relative URLs against the page's own
 * final URL and only accepts https results, consistent with the SSRF policy
 * fetch-image.ts enforces before actually downloading this URL — a listing
 * page is free to publish a relative or http image URL, but this app will
 * only ever fetch an https one.
 */
export function extractImageUrl(html: string, pageUrl: string): string | null {
  for (const strategy of STRATEGIES) {
    const raw = strategy(html);
    if (raw === null) continue;
    try {
      const resolved = new URL(raw, pageUrl);
      if (resolved.protocol === "https:") return resolved.toString();
    } catch {
      // Malformed image URL — try the next strategy rather than fail.
    }
  }
  return null;
}
