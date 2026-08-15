import { z } from "zod";

export const COMPARABLE_PRICE_TYPES = ["ASKING", "SOLD", "UNKNOWN"] as const;

/**
 * Shared wire type: what any MarketResearchProvider must return, and (for
 * the web-search implementation) also doubles as the AI's structured-output
 * schema, since the shapes are identical. Every field except title/priceType
 * is nullable — partial or unknown data is a valid, expected outcome, not an
 * error.
 */
export const comparableSearchResultSchema = z.object({
  title: z.string(),
  marketplace: z.string().nullable(),
  priceCents: z.number().int().nullable(),
  // SOLD must only be set when the source explicitly said so (e.g. an eBay
  // "Sold" listing) — never inferred from an active listing's asking price.
  priceType: z.enum(COMPARABLE_PRICE_TYPES),
  url: z.string().nullable(),
  condition: z.string().nullable(),
  recency: z.string().nullable(),
  confidence: z.number(),
});

export type ComparableSearchResult = z.infer<typeof comparableSearchResultSchema>;

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
