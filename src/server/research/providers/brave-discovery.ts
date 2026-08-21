import type { ImageInput } from "@/server/ai";
import type {
  ComparableCandidate,
  ComparableSearchResult,
  MarketResearchProvider,
  MarketResearchQuery,
} from "../provider";
import { discoverCandidates } from "../discovery/orchestrate";
import { enrichComparables } from "../enrichment/enrich-comparables";
import { fetchListingImage } from "../enrichment/fetch-image";
import { mapWithConcurrency } from "../enrichment/concurrency";
import { matchCandidates, type MatchCandidateInput } from "../discovery/match-candidates";
import {
  matchCandidatesVisual,
  type VisualMatchCandidateInput,
  type VisualMatchJudgment,
} from "../discovery/match-candidates-visual";
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
    imageUrl: null,
  };
}

/**
 * Cross-checks Stage 1's priceType judgment against the page's own
 * deterministic availability signal (extract-price.ts, via enrichComparables)
 * — matchCandidates only ever sees a title/snippet, so a SOLD claim there is
 * still just a text judgment, exactly what comparableCandidateSchema's
 * priceType doc comment warns against trusting on its own. Only downgrades
 * on an actual contradiction (page confirms still available); a SOLD claim
 * with no availability signal at all (most marketplaces are best-effort or
 * blocked — see the Discovery & Matching tab) is left alone rather than
 * blanket-discarded for lack of evidence either way.
 */
function reconcilePriceType(comp: ComparableSearchResult): ComparableSearchResult {
  if (comp.priceType === "SOLD" && comp.availabilitySignal === "AVAILABLE") {
    return { ...comp, priceType: "UNKNOWN" };
  }
  return comp;
}

// Stage 2 (visual) shortlist bounds — see match-candidates-visual.ts. Below
// MIN_STAGE1_CONFIDENCE_FOR_VISUAL_CHECK, min(stage1, visual) could never
// reach the 0.5 usability bar (comparables.ts) anyway, so there's no reason
// to spend an image fetch or vision call on it.
const MAX_VISUAL_SHORTLIST = 10;
const MIN_STAGE1_CONFIDENCE_FOR_VISUAL_CHECK = 0.3;
const IMAGE_FETCH_CONCURRENCY = 4;

export interface BraveDiscoveryProviderOptions {
  discover?: typeof discoverCandidates;
  enrich?: typeof enrichComparables;
  match?: typeof matchCandidates;
  matchVisual?: typeof matchCandidatesVisual;
  fetchImage?: typeof fetchListingImage;
}

/**
 * The Phase 5.6 MarketResearchProvider: Sellstice-controlled discovery
 * (Brave-backed, orchestrate.ts) → existing Phase 5.5 enrichment/price
 * verification (unchanged) → bounded tool-free LLM match judgment
 * (match-candidates.ts) → Phase 10.1's bounded vision confirmation on a
 * shortlist (match-candidates-visual.ts). Structurally distinct from the
 * retired WebSearchComparableProvider: no step here gives the LLM a search
 * tool — it only judges candidates Sellstice's own code already retrieved
 * and price-verified.
 */
export class BraveDiscoveryComparableProvider implements MarketResearchProvider {
  readonly name = "brave_discovery";
  private readonly discover: typeof discoverCandidates;
  private readonly enrich: typeof enrichComparables;
  private readonly match: typeof matchCandidates;
  private readonly matchVisual: typeof matchCandidatesVisual;
  private readonly fetchImage: typeof fetchListingImage;

  constructor(options: BraveDiscoveryProviderOptions = {}) {
    this.discover = options.discover ?? discoverCandidates;
    this.enrich = options.enrich ?? enrichComparables;
    this.match = options.match ?? matchCandidates;
    this.matchVisual = options.matchVisual ?? matchCandidatesVisual;
    this.fetchImage = options.fetchImage ?? fetchListingImage;
  }

  /**
   * Stage 2: vision-confirms a bounded shortlist of Stage 1 survivors that
   * have a candidate image, combining scores via min() so a visual mismatch
   * can only cap confidence down, never inflate it — this is what enforces
   * "fewer genuinely similar comparables over many loosely related ones."
   * Never throws — a total Stage 2 failure (network error, refusal,
   * malformed output) degrades to Stage 1's score alone for every candidate,
   * since visual confirmation is an enhancement layer, not a hard
   * dependency, matching the "one failure never sinks the batch" convention
   * already used by discoverCandidates/enrichOne.
   */
  private async applyVisualConfirmation(
    candidates: ComparableSearchResult[],
    itemPhotos: ImageInput[],
  ): Promise<ComparableSearchResult[]> {
    if (itemPhotos.length === 0) return candidates;

    const shortlistIndexes = candidates
      .map((c, i) => ({ i, confidence: c.matchConfidence }))
      .filter(
        ({ confidence, i }) =>
          confidence >= MIN_STAGE1_CONFIDENCE_FOR_VISUAL_CHECK && candidates[i].imageUrl !== null,
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_VISUAL_SHORTLIST)
      .map(({ i }) => i);

    if (shortlistIndexes.length === 0) return candidates;

    const fetchedImages = await mapWithConcurrency(shortlistIndexes, IMAGE_FETCH_CONCURRENCY, async (i) => {
      const url = candidates[i].imageUrl;
      if (url === null) return null;
      const result = await this.fetchImage(url);
      return result.status === "ok" ? { base64: result.base64, mediaType: result.mediaType } : null;
    });

    const visualInputs: VisualMatchCandidateInput[] = [];
    shortlistIndexes.forEach((i, position) => {
      const image = fetchedImages[position];
      if (image === null) return;
      visualInputs.push({
        index: i,
        title: candidates[i].title,
        marketplace: candidates[i].marketplace ?? "unknown",
        image,
      });
    });

    if (visualInputs.length === 0) return candidates;

    let judgments: VisualMatchJudgment[];
    try {
      judgments = await this.matchVisual(itemPhotos, visualInputs);
    } catch (err) {
      // Static message, dynamic value as a separate arg — same log-forging
      // avoidance as orchestrate.ts's existing console.error pattern.
      console.error(
        "Visual match confirmation failed, falling back to text-only confidence:",
        err instanceof Error ? err.message : err,
      );
      return candidates;
    }

    const judgmentByIndex = new Map(judgments.map((j) => [j.index, j]));
    return candidates.map((c, i) => {
      const judgment = judgmentByIndex.get(i);
      if (!judgment) return c;
      return {
        ...c,
        matchConfidence: Math.min(c.matchConfidence, judgment.visualSimilarity),
        visualSimilarity: judgment.visualSimilarity,
      };
    });
  }

  async findComparables(
    query: MarketResearchQuery,
    itemPhotos: ImageInput[] = [],
  ): Promise<ComparableSearchResult[]> {
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
    const withStage1 = enriched.map((c, i) => reconcilePriceType({ ...c, ...judgments[i] }));

    return this.applyVisualConfirmation(withStage1, itemPhotos);
  }
}
