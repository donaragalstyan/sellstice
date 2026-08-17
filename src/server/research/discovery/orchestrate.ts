import type { MarketResearchQuery } from "../provider";
import type { DiscoveredCandidate, MarketplaceDiscoveryProvider } from "./types";
import { BraveMarketplaceDiscoveryProvider } from "./providers/brave";
import { KNOWN_MARKETPLACES } from "./listing-url-shape";

const BEST_EFFORT_MARKETPLACES = new Set(["mercari.com"]);

function defaultProviders(): MarketplaceDiscoveryProvider[] {
  // eBay is deliberately absent — its adapter (providers/ebay.ts) is an
  // interface-only stub until Browse API credentials arrive. Adding it here
  // is a one-line change once discover() has a real implementation.
  return KNOWN_MARKETPLACES.map(
    (marketplace) =>
      new BraveMarketplaceDiscoveryProvider(marketplace, {
        bestEffort: BEST_EFFORT_MARKETPLACES.has(marketplace),
      }),
  );
}

export interface DiscoveryOrchestratorOptions {
  /** Injectable for tests — production default is the four Brave adapters. */
  providers?: MarketplaceDiscoveryProvider[];
}

/**
 * Fans out to every configured discovery provider and flattens whatever
 * comes back. One provider throwing never sinks the others (Promise.allSettled,
 * not Promise.all) — the whole point of Sellstice-controlled discovery is
 * that no single marketplace's failure blocks the run. A best-effort
 * provider's failure (currently only Mercari) is an expected, silent
 * outcome; any other provider's failure is logged but still non-fatal.
 *
 * No deduplication here — that already exists downstream in comparables.ts,
 * operating on the richer, post-enrichment ComparableSearchResult shape;
 * duplicating it here on raw candidates would be redundant and could hide
 * the difference between "two providers found the same candidate" and
 * "the same real listing represented two different ways" before URL
 * normalization gets a chance to run.
 *
 * The total request budget is bounded by construction — each provider caps
 * its own request count internally (see providers/brave.ts /
 * build-queries.ts), and the provider list itself is fixed-length — so no
 * runtime budget counter is needed here.
 */
export async function discoverCandidates(
  query: MarketResearchQuery,
  options: DiscoveryOrchestratorOptions = {},
): Promise<DiscoveredCandidate[]> {
  const providers = options.providers ?? defaultProviders();
  const settled = await Promise.allSettled(providers.map((provider) => provider.discover(query)));

  const results: DiscoveredCandidate[] = [];
  settled.forEach((outcome, index) => {
    const provider = providers[index];
    if (outcome.status === "fulfilled") {
      results.push(...outcome.value);
      return;
    }
    if (provider.bestEffort) return;
    console.error(
      `Discovery provider "${provider.marketplace}" failed:`,
      outcome.reason instanceof Error ? outcome.reason.message : outcome.reason,
    );
  });
  return results;
}
