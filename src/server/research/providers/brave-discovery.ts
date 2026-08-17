import type {
  ComparableCandidate,
  ComparableSearchResult,
  MarketResearchProvider,
  MarketResearchQuery,
} from "../provider";
import { discoverCandidates } from "../discovery/orchestrate";
import { enrichComparables } from "../enrichment/enrich-comparables";
import { matchCandidates, type MatchCandidateInput } from "../discovery/match-candidates";
import type { DiscoveredCandidate } from "../discovery/types";

/**
 * Bridges a raw discovery hit into the shape enrichComparables (Phase 5.5,
 * unchanged) expects. The judgment fields here are inert placeholders —
 * never read downstream — because enrichComparables needs *a*
 * ComparableCandidate to do its job (fetch + verify price) but has no
 * opinion on matchConfidence/priceType/condition/recency; matchCandidates's
 * real judgment unconditionally overwrites all four afterward (see
 * findComparables below). Reusing ComparableCandidate here, rather than
 * loosening its fields to optional in provider.ts, keeps provider.ts and
 * enrich-comparables.ts completely untouched.
 */
function toPlaceholderCandidate(discovered: DiscoveredCandidate): ComparableCandidate {
  return {
    title: discovered.title,
    marketplace: discovered.marketplace,
    priceType: "UNKNOWN",
    url: discovered.url,
    condition: null,
    recency: null,
    matchConfidence: 0,
  };
}

export interface BraveDiscoveryProviderOptions {
  discover?: typeof discoverCandidates;
  enrich?: typeof enrichComparables;
  match?: typeof matchCandidates;
}

/**
 * The Phase 5.6 MarketResearchProvider: Sellstice-controlled discovery
 * (Brave-backed, orchestrate.ts) → existing Phase 5.5 enrichment/price
 * verification (unchanged) → bounded tool-free LLM match judgment
 * (match-candidates.ts). Structurally distinct from WebSearchComparableProvider:
 * no step here gives the LLM a search tool — it only judges candidates
 * Sellstice's own code already retrieved and price-verified.
 */
export class BraveDiscoveryComparableProvider implements MarketResearchProvider {
  readonly name = "brave_discovery";
  private readonly discover: typeof discoverCandidates;
  private readonly enrich: typeof enrichComparables;
  private readonly match: typeof matchCandidates;

  constructor(options: BraveDiscoveryProviderOptions = {}) {
    this.discover = options.discover ?? discoverCandidates;
    this.enrich = options.enrich ?? enrichComparables;
    this.match = options.match ?? matchCandidates;
  }

  async findComparables(query: MarketResearchQuery): Promise<ComparableSearchResult[]> {
    const discovered = await this.discover(query);
    if (discovered.length === 0) return [];

    const enriched = await this.enrich(discovered.map(toPlaceholderCandidate));

    // Zipped by index — discovered.map(...) and enrichComparables both
    // preserve array order/length 1:1, so discovered[i] and enriched[i]
    // describe the same candidate. This is how the discovery snippet (which
    // has nowhere to live in the ComparableCandidate shape) reaches the
    // matching step despite the placeholder bridge above.
    const matchInputs: MatchCandidateInput[] = enriched.map((c, i) => ({
      marketplace: discovered[i].marketplace,
      title: c.title,
      snippet: discovered[i].snippet,
      priceCents: c.priceCents,
    }));
    const judgments = await this.match(query, matchInputs);

    // Unconditional overwrite of the placeholder judgment fields with the
    // real ones — see toPlaceholderCandidate's doc comment.
    return enriched.map((c, i) => ({ ...c, ...judgments[i] }));
  }
}
