import type { ComparableCandidate, ComparableSearchResult } from "../provider";
import { fetchListingHtml, type FetchResult } from "./fetch-listing";
import { extractPrice, type PriceExtractionResult } from "./extract-price";
import { extractImageUrl } from "./extract-image";
import { mapWithConcurrency } from "./concurrency";

const DEFAULT_CONCURRENCY = Number(process.env.MARKET_RESEARCH_FETCH_CONCURRENCY) || 4;

export interface EnrichComparablesOptions {
  concurrency?: number;
  fetchHtml?: (url: string) => Promise<FetchResult>;
  extract?: (html: string) => PriceExtractionResult;
  extractImage?: (html: string, pageUrl: string) => string | null;
}

async function enrichOne(
  candidate: ComparableCandidate,
  fetchHtml: (url: string) => Promise<FetchResult>,
  extract: (html: string) => PriceExtractionResult,
  extractImage: (html: string, pageUrl: string) => string | null,
): Promise<ComparableSearchResult> {
  // visualSimilarity is always a placeholder here — it's Stage 2's field
  // (discovery/match-candidates-visual.ts, assigned in
  // providers/brave-discovery.ts), never enrichment's, same
  // placeholder-then-overwrite pattern as matchConfidence.
  if (candidate.url === null) {
    return {
      ...candidate,
      priceCents: null,
      priceEvidence: "UNVERIFIED",
      priceEvidenceDetail: "candidate has no listing URL to verify a price against",
      availabilitySignal: null,
      imageUrl: null,
      visualSimilarity: null,
    };
  }
  try {
    const fetchResult = await fetchHtml(candidate.url);
    if (fetchResult.status === "blocked") {
      return {
        ...candidate,
        priceCents: null,
        priceEvidence: "BLOCKED",
        priceEvidenceDetail: fetchResult.reason,
        availabilitySignal: null,
        imageUrl: null,
        visualSimilarity: null,
      };
    }
    if (fetchResult.status === "error") {
      return {
        ...candidate,
        priceCents: null,
        priceEvidence: "UNVERIFIED",
        priceEvidenceDetail: fetchResult.reason,
        availabilitySignal: null,
        imageUrl: null,
        visualSimilarity: null,
      };
    }
    // Image extraction reads the same already-fetched HTML — no extra
    // request — and never blocks or downgrades the price result even if it
    // fails to find anything.
    const imageUrl = extractImage(fetchResult.html, fetchResult.finalUrl);
    const extraction = extract(fetchResult.html);
    if (extraction.evidence === "UNVERIFIED") {
      return {
        ...candidate,
        priceCents: null,
        priceEvidence: "UNVERIFIED",
        priceEvidenceDetail: extraction.reason,
        availabilitySignal: null,
        imageUrl,
        visualSimilarity: null,
      };
    }
    return {
      ...candidate,
      priceCents: extraction.priceCents,
      priceEvidence: extraction.evidence,
      priceEvidenceDetail: null,
      availabilitySignal: extraction.availability,
      imageUrl,
      visualSimilarity: null,
    };
  } catch (err) {
    // An unexpected failure here must not sink the rest of the batch, and
    // must never leave the AI's own unverified priceCents guess standing in
    // for a real one.
    return {
      ...candidate,
      priceCents: null,
      priceEvidence: "UNVERIFIED",
      priceEvidenceDetail: `unexpected error during enrichment: ${err instanceof Error ? err.message : "unknown error"}`,
      availabilitySignal: null,
      imageUrl: null,
      visualSimilarity: null,
    };
  }
}

/**
 * Turns discovery candidates into the final wire type by fetching each
 * candidate's URL and running deterministic price extraction on it,
 * bounded to `concurrency` requests in flight at once. A candidate's own
 * priceCents (whatever the AI happened to see in a search snippet) is
 * always discarded and replaced — this function is the only place a
 * ComparableSearchResult's priceCents is allowed to come from, and it is
 * never non-null without a matching non-UNVERIFIED/BLOCKED priceEvidence.
 * One candidate's fetch/extract failure never fails the batch — see
 * enrichOne's catch.
 */
export async function enrichComparables(
  candidates: ComparableCandidate[],
  options: EnrichComparablesOptions = {},
): Promise<ComparableSearchResult[]> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    fetchHtml = fetchListingHtml,
    extract = extractPrice,
    extractImage = extractImageUrl,
  } = options;

  return mapWithConcurrency(candidates, concurrency, (candidate) =>
    enrichOne(candidate, fetchHtml, extract, extractImage),
  );
}
