/**
 * Phase 5.6 discovery-provider pilot — NOT production code.
 *
 * Answers one question: can Brave's Web Search API reliably surface real
 * individual listing URLs on Vinted, Depop, Poshmark, and Mercari (the four
 * marketplaces without an official search API), well enough to seed the
 * existing Phase 5.5 fetch/enrichment pipeline as discovery candidates?
 *
 * Standalone and deliberately disconnected from the app: no DB, no server
 * actions, no UI, no LLM calls, no page crawling. Safe to delete after the
 * pilot has been evaluated. Run with:
 *
 *   node --import tsx scripts/brave-marketplace-pilot.ts
 *
 * Reads BRAVE_SEARCH_API_KEY from the environment (loaded from .env below)
 * and never logs its value.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env file present — fine, the key may already be in the environment.
}

const API_KEY = process.env.BRAVE_SEARCH_API_KEY;
if (!API_KEY) {
  console.error("BRAVE_SEARCH_API_KEY is not configured");
  process.exit(1);
}

const MARKETPLACES = ["vinted.com", "depop.com", "poshmark.com", "mercari.com"] as const;
type Marketplace = (typeof MARKETPLACES)[number];

// One deliberately ambiguous item (a generic-sounding hoodie where text
// matching alone could pull in unrelated green/graphic hoodies), one
// unambiguous iconic item, and one recognizable-by-style item — a small,
// fair spread rather than an exhaustive catalog.
const QUERIES = [
  "Zara green graphic hoodie",
  "Levi's 501 blue jeans",
  "Nike Air Force 1 triple white sneakers",
];

const RESULT_COUNT = 8;
const REQUEST_TIMEOUT_MS = 8_000;

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

type Classification = "likely_listing" | "non_listing" | "malformed_unusable";

// Conservative, structural checks only — real individual-listing URL shapes
// on each marketplace as of this pilot. Anything that doesn't match falls
// back to "non_listing" rather than being guessed as a listing.
const LISTING_PATH_PATTERNS: Record<Marketplace, RegExp> = {
  "vinted.com": /^\/items\/\d+(?:-|\/|$)/,
  "depop.com": /^\/products\/[^/]+\/?$/,
  "poshmark.com": /^\/listing\/[^/]+-[0-9a-f]{20,24}\/?$/i,
  "mercari.com": /^\/(?:us\/)?item\/m\d+/i,
};

function classify(marketplace: Marketplace, rawUrl: string): Classification {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "malformed_unusable";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  // Brave's `site:` operator is a strong hint, not a hard guarantee — a
  // result that isn't actually on the target domain is unusable for this
  // pilot regardless of what its path looks like.
  if (host !== marketplace) return "malformed_unusable";
  return LISTING_PATH_PATTERNS[marketplace].test(url.pathname) ? "likely_listing" : "non_listing";
}

function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
  } catch {
    return rawUrl.toLowerCase();
  }
}

interface CollectedResult {
  marketplace: Marketplace;
  query: string;
  title: string;
  url: string;
  description: string | null;
  rank: number;
  latencyMs: number;
  classification: Classification;
  normalizedUrl: string;
}

interface RequestOutcome {
  marketplace: Marketplace;
  query: string;
  ok: boolean;
  reason?: string;
  latencyMs: number;
}

let totalApiRequests = 0;

function isTransientNetworkError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError)
  );
}

async function braveSearchOnce(query: string): Promise<{ results: BraveWebResult[]; latencyMs: number }> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(RESULT_COUNT));

  const start = performance.now();
  totalApiRequests += 1;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": API_KEY as string,
    },
  });
  const latencyMs = performance.now() - start;

  if (!response.ok) {
    throw new Error(`Brave API returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as BraveSearchResponse;
  return { results: body.web?.results ?? [], latencyMs };
}

// Single attempt, at most one bounded retry — only for a transient network
// failure (timeout/abort/connection error), never for an HTTP error status.
async function braveSearch(query: string): Promise<{ results: BraveWebResult[]; latencyMs: number }> {
  try {
    return await braveSearchOnce(query);
  } catch (err) {
    if (isTransientNetworkError(err)) {
      return await braveSearchOnce(query);
    }
    throw err;
  }
}

async function run() {
  const collected: CollectedResult[] = [];
  const outcomes: RequestOutcome[] = [];

  for (const marketplace of MARKETPLACES) {
    for (const query of QUERIES) {
      const braveQuery = `${query} site:${marketplace}`;
      try {
        const { results, latencyMs } = await braveSearch(braveQuery);
        outcomes.push({ marketplace, query, ok: true, latencyMs });
        results.forEach((result, index) => {
          if (!result.url || !result.title) return;
          collected.push({
            marketplace,
            query,
            title: result.title,
            url: result.url,
            description: result.description ?? null,
            rank: index + 1,
            latencyMs,
            classification: classify(marketplace, result.url),
            normalizedUrl: normalizeUrl(result.url),
          });
        });
      } catch (err) {
        outcomes.push({
          marketplace,
          query,
          ok: false,
          reason: err instanceof Error ? err.message : "unknown error",
          latencyMs: 0,
        });
        console.warn(`[pilot] request failed for ${marketplace} / "${query}": ${
          err instanceof Error ? err.message : "unknown error"
        }`);
      }
    }
  }

  printReport(collected, outcomes);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function printReport(collected: CollectedResult[], outcomes: RequestOutcome[]) {
  console.log("\n=== Brave Marketplace Discovery Pilot ===\n");

  for (const marketplace of MARKETPLACES) {
    const marketplaceOutcomes = outcomes.filter((o) => o.marketplace === marketplace);
    const marketplaceResults = collected.filter((r) => r.marketplace === marketplace);

    // First occurrence of a normalized URL (in request order) is the
    // "original"; every later occurrence — whether from the same query or a
    // different one — is a duplicate. Conservative: only exact normalized
    // URL matches are merged, never merged on title similarity.
    const seen = new Set<string>();
    const unique: CollectedResult[] = [];
    let duplicateCount = 0;
    for (const r of marketplaceResults) {
      if (seen.has(r.normalizedUrl)) {
        duplicateCount += 1;
      } else {
        seen.add(r.normalizedUrl);
        unique.push(r);
      }
    }

    const likelyListings = unique.filter((r) => r.classification === "likely_listing");
    const nonListing = unique.filter((r) => r.classification === "non_listing");
    const malformed = unique.filter((r) => r.classification === "malformed_unusable");
    const latencies = marketplaceOutcomes.filter((o) => o.ok).map((o) => o.latencyMs);

    console.log(`--- ${marketplace} ---`);
    console.log(`Requests made: ${marketplaceOutcomes.length} (${marketplaceOutcomes.filter((o) => o.ok).length} ok, ${marketplaceOutcomes.filter((o) => !o.ok).length} failed)`);
    console.log(`Total results returned: ${marketplaceResults.length}`);
    console.log(`Likely individual listings (unique): ${likelyListings.length}`);
    console.log(`Non-listing / category-search-profile pages (unique): ${nonListing.length}`);
    console.log(`Malformed/unusable (off-domain or unparsable) (unique): ${malformed.length}`);
    console.log(`Duplicate URLs (within marketplace, across queries): ${duplicateCount}`);
    console.log(`Request latency — avg: ${(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(0)}ms, median: ${median(latencies).toFixed(0)}ms`);

    if (likelyListings.length > 0) {
      console.log("Likely listing candidates:");
      for (const r of likelyListings) {
        console.log(`  [${r.query}] (#${r.rank}) ${r.title}\n    ${r.url}`);
      }
    }
    if (nonListing.length > 0) {
      console.log("Non-listing results:");
      for (const r of nonListing) {
        console.log(`  [${r.query}] (#${r.rank}) ${r.title}\n    ${r.url}`);
      }
    }
    if (malformed.length > 0) {
      console.log("Malformed/unusable results:");
      for (const r of malformed) {
        console.log(`  [${r.query}] (#${r.rank}) ${r.title}\n    ${r.url}`);
      }
    }
    console.log("");
  }

  console.log("=== Overall summary ===");
  console.log(`Total Brave API requests made: ${totalApiRequests}`);
  const failedCount = outcomes.filter((o) => !o.ok).length;
  if (failedCount > 0) {
    console.log(`Failed requests: ${failedCount} (see warnings above)`);
  }

  for (const marketplace of MARKETPLACES) {
    const marketplaceResults = collected.filter((r) => r.marketplace === marketplace);
    const seen = new Set<string>();
    const unique = marketplaceResults.filter((r) => {
      if (seen.has(r.normalizedUrl)) return false;
      seen.add(r.normalizedUrl);
      return true;
    });
    const likelyListings = unique.filter((r) => r.classification === "likely_listing");
    const ratio = unique.length > 0 ? likelyListings.length / unique.length : 0;

    // A structural heuristic only — it does NOT judge whether the listings
    // are actually relevant to the query, only whether the URL shape looks
    // like an individual listing. Treat this as a rough sort signal; the
    // candidate titles/URLs printed above are what should actually be
    // eyeballed before trusting a rating.
    let coverage: string;
    if (unique.length === 0) coverage = "poor (no usable results)";
    else if (ratio >= 0.5) coverage = "strong (structural heuristic — verify candidates above)";
    else if (ratio >= 0.2) coverage = "mixed (structural heuristic — verify candidates above)";
    else coverage = "poor (structural heuristic — verify candidates above)";

    console.log(`${marketplace}: ${coverage}`);
  }
}

run().catch((err) => {
  console.error("[pilot] unexpected failure:", err instanceof Error ? err.message : err);
  process.exit(1);
});
