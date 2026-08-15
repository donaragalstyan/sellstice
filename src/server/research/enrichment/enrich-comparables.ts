import type { ComparableCandidate, ComparableSearchResult } from "../provider";
import { fetchListingHtml, type FetchResult } from "./fetch-listing";
import { extractPrice, type PriceExtractionResult } from "./extract-price";

const DEFAULT_CONCURRENCY = Number(process.env.MARKET_RESEARCH_FETCH_CONCURRENCY) || 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export interface EnrichComparablesOptions {
  concurrency?: number;
  fetchHtml?: (url: string) => Promise<FetchResult>;
  extract?: (html: string) => PriceExtractionResult;
}

async function enrichOne(
  candidate: ComparableCandidate,
  fetchHtml: (url: string) => Promise<FetchResult>,
  extract: (html: string) => PriceExtractionResult,
): Promise<ComparableSearchResult> {
  if (candidate.url === null) {
    return { ...candidate, priceCents: null, priceEvidence: "UNVERIFIED" };
  }
  try {
    const fetchResult = await fetchHtml(candidate.url);
    if (fetchResult.status === "blocked") {
      return { ...candidate, priceCents: null, priceEvidence: "BLOCKED" };
    }
    if (fetchResult.status === "error") {
      return { ...candidate, priceCents: null, priceEvidence: "UNVERIFIED" };
    }
    const extraction = extract(fetchResult.html);
    if (extraction.evidence === "UNVERIFIED") {
      return { ...candidate, priceCents: null, priceEvidence: "UNVERIFIED" };
    }
    return { ...candidate, priceCents: extraction.priceCents, priceEvidence: extraction.evidence };
  } catch {
    // An unexpected failure here must not sink the rest of the batch, and
    // must never leave the AI's own unverified priceCents guess standing in
    // for a real one.
    return { ...candidate, priceCents: null, priceEvidence: "UNVERIFIED" };
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
  } = options;

  return mapWithConcurrency(candidates, concurrency, (candidate) =>
    enrichOne(candidate, fetchHtml, extract),
  );
}
