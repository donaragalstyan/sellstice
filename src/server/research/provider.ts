import { z } from "zod";

export const COMPARABLE_PRICE_TYPES = ["ASKING", "SOLD", "UNKNOWN"] as const;

export const COMPARABLE_PRICE_EVIDENCE = [
  "STRUCTURED_DATA",
  "META_TAG",
  "MICRODATA",
  "UNVERIFIED",
  "BLOCKED",
] as const;

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

export type ComparableCandidate = z.infer<typeof comparableCandidateSchema>;

/**
 * Shared wire type: what any MarketResearchProvider must return. Extends a
 * discovered candidate with the two things only the enrichment pipeline can
 * supply: priceCents itself, and priceEvidence — the deterministic outcome
 * of trying to verify that price against the actual page (fetch +
 * structured-data extraction), never the AI's own say-so. A provider that
 * can't do verification at all must still set priceEvidence explicitly
 * (e.g. to "UNVERIFIED") rather than omit it, so isUsableComparable can't
 * accidentally trust an unverified price by default.
 */
export type ComparableSearchResult = ComparableCandidate & {
  priceCents: number | null;
  priceEvidence: (typeof COMPARABLE_PRICE_EVIDENCE)[number];
};

export interface MarketResearchQuery {
  brand: string | null;
  color: string | null;
  category: string | null;
  size: string | null;
  condition: string | null;
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
  findComparables(query: MarketResearchQuery): Promise<ComparableSearchResult[]>;
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
