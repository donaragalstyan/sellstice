import { COMPARABLE_PRICE_EVIDENCE } from "../provider";

export type StructuredPriceEvidence = Exclude<
  (typeof COMPARABLE_PRICE_EVIDENCE)[number],
  "UNVERIFIED" | "BLOCKED"
>;

export type PriceExtractionResult =
  | { evidence: StructuredPriceEvidence; priceCents: number; currency: "USD" }
  | { evidence: "UNVERIFIED"; priceCents: null; reason: string };

function parsePriceCents(raw: string | number): number | null {
  const str = typeof raw === "number" ? String(raw) : raw;
  const cleaned = str.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100);
}

function normalizeCurrency(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

// --- Strategy plumbing -------------------------------------------------

type StrategyResult =
  | { found: false }
  | { found: "ambiguous"; reason: string }
  | { found: true; priceCents: number; currency: "USD"; evidence: StructuredPriceEvidence };

export function parseTagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*"([^"]*)"|([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(tag))) {
    const name = (m[1] ?? m[3]).toLowerCase();
    const value = m[2] ?? m[4];
    attrs[name] = value;
  }
  return attrs;
}

// --- Strategy 1: JSON-LD (schema.org Product/Offer) ---------------------
//
// The highest-trust source: this is the same markup sites publish for
// Google Shopping rich results, so it's both machine-readable (JSON.parse,
// not HTML parsing) and meant to be scraped by exactly this kind of
// consumer.

export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptRegex =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD on the page — skip it, never throw.
    }
  }
  return blocks;
}

export function flattenJsonLdNodes(blocks: unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      nodes.push(node);
      if (node["@graph"]) visit(node["@graph"]);
    }
  };
  blocks.forEach(visit);
  return nodes;
}

export function isProductNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type === "Product";
  if (Array.isArray(type)) return type.includes("Product");
  return false;
}

interface PriceCandidate {
  priceCents: number;
  currency: string | null;
}

function collectOfferCandidates(offers: unknown): PriceCandidate[] {
  const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const candidates: PriceCandidate[] = [];
  for (const offer of offerList) {
    if (!offer || typeof offer !== "object") continue;
    const o = offer as Record<string, unknown>;
    const spec = o.priceSpecification as Record<string, unknown> | undefined;
    const rawPrice = o.price ?? spec?.price;
    if (rawPrice === undefined || rawPrice === null) continue;
    const priceCents = parsePriceCents(
      typeof rawPrice === "number" ? rawPrice : String(rawPrice),
    );
    if (priceCents === null) continue;
    const rawCurrency = o.priceCurrency ?? spec?.priceCurrency;
    candidates.push({
      priceCents,
      currency: normalizeCurrency(typeof rawCurrency === "string" ? rawCurrency : undefined),
    });
  }
  return candidates;
}

function resolveCandidates(
  candidates: PriceCandidate[],
  evidence: StructuredPriceEvidence,
  sourceLabel: string,
): StrategyResult {
  if (candidates.length === 0) return { found: false };

  const distinctPrices = new Set(candidates.map((c) => c.priceCents));
  if (distinctPrices.size > 1) {
    return { found: "ambiguous", reason: `multiple distinct prices found in ${sourceLabel}` };
  }
  const { priceCents, currency } = candidates[0];
  if (currency === null) {
    return {
      found: "ambiguous",
      reason: `${sourceLabel} price has no currency, cannot confirm USD`,
    };
  }
  if (currency !== "USD") {
    return { found: "ambiguous", reason: `${sourceLabel} price is in ${currency}, not USD` };
  }
  return { found: true, priceCents, currency: "USD", evidence };
}

function extractFromJsonLd(html: string): StrategyResult {
  const nodes = flattenJsonLdNodes(extractJsonLdBlocks(html));
  const candidates = nodes.filter(isProductNode).flatMap((node) => collectOfferCandidates(node.offers));
  return resolveCandidates(candidates, "STRUCTURED_DATA", "structured data");
}

// --- Strategy 2: Open Graph / product meta tags --------------------------
//
// Lower trust than JSON-LD (a plain key/value pair, not a typed schema) but
// still a deliberate, machine-readable signal the page publishes for link
// previews and shopping crawlers.

export function findMetaContent(html: string, keys: string[]): string | null {
  const tagRegex = /<meta\b[^>]*>/gi;
  const tags = html.match(tagRegex) ?? [];
  for (const tag of tags) {
    const attrs = parseTagAttrs(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (keys.includes(key) && attrs.content !== undefined) {
      return attrs.content;
    }
  }
  return null;
}

function extractFromMetaTags(html: string): StrategyResult {
  const rawPrice = findMetaContent(html, ["product:price:amount", "og:price:amount"]);
  if (rawPrice === null) return { found: false };

  const priceCents = parsePriceCents(rawPrice);
  if (priceCents === null) {
    return {
      found: "ambiguous",
      reason: `meta price tag content "${rawPrice}" is not a parseable amount`,
    };
  }
  const currency = normalizeCurrency(
    findMetaContent(html, ["product:price:currency", "og:price:currency"]),
  );
  if (currency === null) {
    return { found: "ambiguous", reason: "meta price tag has no currency, cannot confirm USD" };
  }
  if (currency !== "USD") {
    return { found: "ambiguous", reason: `meta price tag is in ${currency}, not USD` };
  }
  return { found: true, priceCents, currency: "USD", evidence: "META_TAG" };
}

// --- Strategy 3: schema.org microdata (itemprop="price") -----------------
//
// Weakest signal: microdata's itemprop="priceCurrency" isn't reliably
// positionally correlated to a specific itemprop="price" element via regex
// alone (no real DOM tree here), so a page-wide, unambiguous USD marker is
// required rather than attempting to pair them up.

function extractFromMicrodata(html: string): StrategyResult {
  const priceTags = html.match(/<[^>]+itemprop\s*=\s*["']price["'][^>]*>/gi) ?? [];
  const candidates: number[] = [];
  for (const tag of priceTags) {
    const raw = parseTagAttrs(tag).content;
    if (raw === undefined) continue; // no machine-readable value — inner-text parsing is too unreliable to attempt here
    const priceCents = parsePriceCents(raw);
    if (priceCents !== null) candidates.push(priceCents);
  }
  if (candidates.length === 0) return { found: false };

  const distinct = new Set(candidates);
  if (distinct.size > 1) {
    return { found: "ambiguous", reason: "multiple distinct microdata prices found" };
  }

  const currencyTags = html.match(/<[^>]+itemprop\s*=\s*["']pricecurrency["'][^>]*>/gi) ?? [];
  const currencies = new Set(
    currencyTags
      .map((tag) => normalizeCurrency(parseTagAttrs(tag).content))
      .filter((c): c is string => c !== null),
  );
  if (currencies.size !== 1 || !currencies.has("USD")) {
    return {
      found: "ambiguous",
      reason: "microdata price has no unambiguous USD currency marker",
    };
  }
  return { found: true, priceCents: [...distinct][0], currency: "USD", evidence: "MICRODATA" };
}

// --- Entry point -----------------------------------------------------------

const STRATEGIES: Array<(html: string) => StrategyResult> = [
  extractFromJsonLd,
  extractFromMetaTags,
  extractFromMicrodata,
];

/**
 * Deterministic, network-free price extraction from a fetched listing page.
 * Tries strategies in trust order (structured data > meta tags > microdata)
 * and stops at the first one that finds anything: if that strategy's own
 * data is internally ambiguous (conflicting prices, unconfirmed currency),
 * the whole page is reported UNVERIFIED rather than falling through to a
 * weaker signal that might silently disagree with it. Never guesses — the
 * only way this returns a priceCents is a single, unambiguous, USD-
 * confirmed value.
 */
export function extractPrice(html: string): PriceExtractionResult {
  for (const strategy of STRATEGIES) {
    const result = strategy(html);
    if (result.found === true) {
      return { evidence: result.evidence, priceCents: result.priceCents, currency: result.currency };
    }
    if (result.found === "ambiguous") {
      return { evidence: "UNVERIFIED", priceCents: null, reason: result.reason };
    }
  }
  return {
    evidence: "UNVERIFIED",
    priceCents: null,
    reason: "no price found in structured data, meta tags, or microdata",
  };
}
