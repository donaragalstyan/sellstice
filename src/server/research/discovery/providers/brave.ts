import type { MarketResearchQuery } from "../../provider";
import type { DiscoveredCandidate, MarketplaceDiscoveryProvider } from "../types";
import { buildSearchQueries } from "../build-queries";
import { classifyListingUrl } from "../listing-url-shape";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

// Hardcoded rather than env-tunable — the marketplace pilot
// (scripts/brave-marketplace-pilot.ts) already validated these against the
// real API, and this is a search-API call, not a listing-page fetch, so it
// deliberately doesn't share MARKET_RESEARCH_FETCH_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RESULT_COUNT = 8;

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

export interface BraveAdapterOptions {
  apiKey?: string;
  timeoutMs?: number;
  resultCount?: number;
  /** Injectable for tests — production default is the real fetch. */
  fetchImpl?: typeof fetch;
  bestEffort?: boolean;
}

function isTransientNetworkError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError);
}

/**
 * One marketplace's Brave-backed discovery adapter. Reuses the pilot's
 * bounded-fetch pattern exactly: AbortSignal.timeout, at most one retry and
 * only for a transient network failure (never for an HTTP error status),
 * fixed small query count (build-queries.ts), fixed small result count. The
 * only filtering this does is structural (listing-url-shape.ts) — no
 * semantic scoring, per the recall-over-precision instruction; that's the
 * matching step's job (discovery/match-candidates.ts).
 */
export class BraveMarketplaceDiscoveryProvider implements MarketplaceDiscoveryProvider {
  readonly marketplace: string;
  readonly bestEffort: boolean;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly resultCount: number;
  private readonly fetchImpl: typeof fetch;

  constructor(marketplace: string, options: BraveAdapterOptions = {}) {
    this.marketplace = marketplace;
    this.bestEffort = options.bestEffort ?? false;
    this.apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.resultCount = options.resultCount ?? DEFAULT_RESULT_COUNT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async braveSearchOnce(query: string): Promise<BraveWebResult[]> {
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(this.resultCount));

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey ?? "",
      },
    });
    if (!response.ok) {
      throw new Error(`Brave API returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as BraveSearchResponse;
    return body.web?.results ?? [];
  }

  private async braveSearch(query: string): Promise<BraveWebResult[]> {
    try {
      return await this.braveSearchOnce(query);
    } catch (err) {
      if (isTransientNetworkError(err)) {
        return await this.braveSearchOnce(query);
      }
      throw err;
    }
  }

  /**
   * Never throws — a failed Brave call for this marketplace (bad HTTP
   * status, exhausted retry) resolves to [] rather than sinking the whole
   * research run, matching the "one failure never sinks the batch"
   * convention already established in enrichComparables.
   */
  async discover(query: MarketResearchQuery): Promise<DiscoveredCandidate[]> {
    const searchQueries = buildSearchQueries(query);
    const candidates: DiscoveredCandidate[] = [];

    for (const searchQuery of searchQueries) {
      let results: BraveWebResult[];
      try {
        results = await this.braveSearch(`${searchQuery} site:${this.marketplace}`);
      } catch {
        continue;
      }
      results.forEach((result, index) => {
        if (!result.url || !result.title) return;
        if (classifyListingUrl(this.marketplace, result.url) !== "listing") return;
        candidates.push({
          marketplace: this.marketplace,
          title: result.title,
          url: result.url,
          snippet: result.description ?? null,
          sourceRank: index + 1,
        });
      });
    }
    return candidates;
  }
}
