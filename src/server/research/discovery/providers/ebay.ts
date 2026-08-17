import type { MarketResearchQuery } from "../../provider";
import type { DiscoveredCandidate, MarketplaceDiscoveryProvider } from "../types";

export interface EbayAdapterOptions {
  clientId?: string;
  clientSecret?: string;
}

/**
 * Interface-only stub — blocked on eBay Browse API credentials (expected
 * Tuesday). No OAuth2 client-credentials token exchange, no Browse API
 * call, no response mapping, and no live test against api.ebay.com belong
 * here yet. Not referenced by discovery/orchestrate.ts's default provider
 * list; wiring it in is a one-line addition once discover() has a real
 * implementation, not a restructure.
 */
export class EbayMarketplaceDiscoveryProvider implements MarketplaceDiscoveryProvider {
  readonly marketplace = "ebay.com";
  readonly bestEffort = false;

  constructor(private readonly options: EbayAdapterOptions = {}) {}

  async discover(_query: MarketResearchQuery): Promise<DiscoveredCandidate[]> {
    throw new Error(
      "eBay discovery is not yet implemented — blocked on eBay Browse API credentials (Phase 5.6 plan).",
    );
  }
}
