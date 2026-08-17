import type { MarketResearchQuery } from "../provider";

/**
 * What a discovery adapter (Brave-backed, eventually eBay) produces before
 * anything has judged it. Deliberately separate from ComparableCandidate
 * (provider.ts) — a raw search hit has no matchConfidence, priceType, or
 * condition yet; those only exist after the matching step
 * (discovery/match-candidates.ts). Bundling them here would recreate the
 * discovery/judgment conflation Phase 5.6 exists to remove.
 *
 * Phase 5.7 seam: an optional imageUrl (or similar) can be added here later
 * without breaking existing adapters, since every field currently present
 * stays required.
 */
export interface DiscoveredCandidate {
  marketplace: string;
  title: string;
  url: string;
  snippet: string | null;
  /** 1-based position within this adapter's own result set. */
  sourceRank: number;
}

export interface MarketplaceDiscoveryProvider {
  readonly marketplace: string;
  /**
   * True only for marketplaces where zero results is an accepted, silent
   * outcome (currently just Mercari) — read by the orchestrator to decide
   * whether a failed/empty discover() call is worth a warning log.
   */
  readonly bestEffort: boolean;
  discover(query: MarketResearchQuery): Promise<DiscoveredCandidate[]>;
}
