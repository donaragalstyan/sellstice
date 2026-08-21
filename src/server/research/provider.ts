import { z } from "zod";
import type { ImageInput } from "@/server/ai";

export const COMPARABLE_PRICE_TYPES = ["ASKING", "SOLD", "UNKNOWN"] as const;

export const COMPARABLE_PRICE_EVIDENCE = [
  "STRUCTURED_DATA",
  "META_TAG",
  "MICRODATA",
  "UNVERIFIED",
  "BLOCKED",
] as const;

/**
 * Whether the page's own structured data confirms the item is still
 * available or confirms it sold — read verbatim from a schema.org
 * Offer.availability value during enrichment (enrichment/extract-price.ts),
 * never inferred. Used only to cross-check an AI-claimed priceType: "SOLD"
 * against real page evidence (see providers/brave-discovery.ts) — "SOLD"
 * must only be trusted when the source explicitly said so (see
 * comparableCandidateSchema's priceType doc comment below), and this is the
 * deterministic backstop for that claim, not just a prompt instruction.
 * "SOLD" here is live-verified against real Poshmark listings (search
 * filtered to Sold Items): a confirmed-sold listing's availability is
 * "https://schema.org/OutOfStock", not the more literally-named "SoldOut" —
 * both map to SOLD since they're the same schema.org ItemAvailability
 * concept, but only OutOfStock has actually been observed. "UNKNOWN" is the
 * safe default whenever the page gives no unambiguous signal either way.
 */
export type PageAvailabilitySignal = "AVAILABLE" | "SOLD" | "UNKNOWN";

/**
 * What the AI's web-search discovery step must return. Deliberately has no
 * price field at all — a search snippet is not a reliable source for a
 * number that has to be exact, and asking the model to chase one down is
 * exactly what was driving extra web_search tool calls (and the latency
 * that came with them). Price is entirely the enrichment pipeline's job
 * (fetch + deterministic extraction — see enrichment/enrich-comparables.ts)
 * (see ComparableSearchResult below). Every field except title/priceType is
 * nullable — partial or unknown data is a valid, expected outcome, not an
 * error.
 */
export const comparableCandidateSchema = z.object({
  title: z.string(),
  marketplace: z.string().nullable(),
  // SOLD must only be set when the source explicitly said so (e.g. an eBay
  // "Sold" listing) — never inferred from an active listing's asking price.
  priceType: z.enum(COMPARABLE_PRICE_TYPES),
  url: z.string().nullable(),
  condition: z.string().nullable(),
  recency: z.string().nullable(),
  // How well this listing matches the item's attributes — an AI judgment
  // call, and deliberately independent of price verification (see
  // ComparablePriceEvidence's doc comment in the Prisma schema).
  matchConfidence: z.number(),
});

export type ComparableCandidate = z.infer<typeof comparableCandidateSchema> & {
  // The candidate listing's own photo URL, deterministically extracted from
  // the same already-fetched HTML as price (enrichment/extract-image.ts) —
  // never guessed by the AI, same reasoning as priceCents. Null until
  // enrichment runs, and stays null if the page publishes no usable image.
  imageUrl: string | null;
};

/**
 * Shared wire type: what any MarketResearchProvider must return. Extends a
 * discovered candidate with the things only the enrichment/matching pipeline
 * can supply: priceCents itself, and priceEvidence — the deterministic
 * outcome of trying to verify that price against the actual page (fetch +
 * structured-data extraction), never the AI's own say-so. A provider that
 * can't do verification at all must still set priceEvidence explicitly
 * (e.g. to "UNVERIFIED") rather than omit it, so isUsableComparable can't
 * accidentally trust an unverified price by default. visualSimilarity is the
 * raw Stage 2 (discovery/match-candidates-visual.ts) signal — null when no
 * validated candidate image was available to compare against the seller's
 * own photos, distinct from matchConfidence, which may already be the
 * text/visual combination (see providers/brave-discovery.ts).
 */
export type ComparableSearchResult = ComparableCandidate & {
  priceCents: number | null;
  priceEvidence: (typeof COMPARABLE_PRICE_EVIDENCE)[number];
  // Why priceEvidence isn't a trusted value — e.g. "multiple distinct prices
  // found in structured data" or "HTTP 403" — the reason enrichment already
  // computes internally but previously discarded. Null whenever priceEvidence
  // is trusted (STRUCTURED_DATA/META_TAG/MICRODATA): a positive result speaks
  // for itself and needs no explanation.
  priceEvidenceDetail: string | null;
  // Null whenever no extraction ran at all (no URL, fetch blocked/errored) —
  // distinct from "UNKNOWN", which means extraction ran but the page gave no
  // availability signal either way.
  availabilitySignal: PageAvailabilitySignal | null;
  visualSimilarity: number | null;
};

export interface MarketResearchQuery {
  brand: string | null;
  color: string | null;
  category: string | null;
  size: string | null;
  condition: string | null;
  // The item's own free-text "notable details" field (user-entered, not an
  // AI guess) — e.g. a distinctive graphic, pattern, or embroidery that a
  // generic brand/color/category search would miss. Bounded at query-build
  // time (discovery/build-queries.ts) since this field can hold up to 2000
  // chars of free text (see lib/validation.ts), far more than a search
  // query should ever carry.
  notableDetails: string | null;
}

/**
 * Deliberately separate from AIProvider: this is a text/tool-driven search
 * capability, not vision, and future implementations (a marketplace API, an
 * OpenClaw-based agent) may not call an LLM at all. Manual comparable entry
 * does not go through this interface — there's no "search" step when the
 * user is the source; see the manual-entry action instead.
 */
export interface MarketResearchProvider {
  readonly name: string;
  /**
   * itemPhotos is optional so a provider with no visual-matching capability
   * (or a future non-photo-aware provider) stays a valid implementer of this
   * interface — only BraveDiscoveryComparableProvider currently reads it.
   */
  findComparables(
    query: MarketResearchQuery,
    itemPhotos?: ImageInput[],
  ): Promise<ComparableSearchResult[]>;
}

export class MarketResearchProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MarketResearchProviderError";
  }
}
