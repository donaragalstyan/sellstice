import { BraveDiscoveryComparableProvider } from "./providers/brave-discovery";
import { getCooldownRemainingMs } from "@/server/ai/cooldown";
import type { ComparableSearchResult, MarketResearchQuery } from "./provider";
import type { ImageInput } from "@/server/ai";

const provider = new BraveDiscoveryComparableProvider();

export async function findComparableListings(
  query: MarketResearchQuery,
  itemPhotos: ImageInput[] = [],
): Promise<ComparableSearchResult[]> {
  return provider.findComparables(query, itemPhotos);
}

/**
 * Research is a heavier operation (a web search, not a bounded extraction),
 * so its cooldown is longer than item analysis / photo coach's 30s. Same
 * rationale otherwise: server-side backstop against double-clicks, extra
 * tabs, or a direct call to the server action.
 */
export const MARKET_RESEARCH_COOLDOWN_MS = 60_000;

export function getMarketResearchCooldownRemainingMs(
  lastRunAt: Date | null,
  now: Date,
  cooldownMs = MARKET_RESEARCH_COOLDOWN_MS,
): number {
  return getCooldownRemainingMs(lastRunAt, now, cooldownMs);
}

/** Don't spend a research call on an item with nothing to search for. */
export function hasEnoughAttributesToResearch(query: MarketResearchQuery): boolean {
  return Boolean(query.brand || query.category);
}

// --- Deduplication -----------------------------------------------------

interface ComparableKeyFields {
  url: string | null;
  title: string;
  marketplace: string | null;
  priceCents: number | null;
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two comps are "obviously" the same listing if they share a URL, or —
 * lacking one — the same normalized title, marketplace, and price. */
function comparableKey(comp: ComparableKeyFields): string {
  return comp.url
    ? `url:${normalizeUrlKey(comp.url)}`
    : `sig:${normalizeTitleKey(comp.title)}|${(comp.marketplace ?? "").toLowerCase()}|${comp.priceCents ?? "null"}`;
}

/** Dedupes within a single batch, keeping the first occurrence of each. */
export function deduplicateComparables<T extends ComparableKeyFields>(comps: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const comp of comps) {
    const key = comparableKey(comp);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(comp);
  }
  return result;
}

/**
 * Filters `incoming` down to comps not already present in `existing`, so
 * re-running research on an item accumulates genuinely new listings instead
 * of re-inserting the same real-world result every time.
 */
export function deduplicateAgainstExisting<T extends ComparableKeyFields>(
  existing: ComparableKeyFields[],
  incoming: T[],
): T[] {
  const seen = new Set(existing.map(comparableKey));
  const result: T[] = [];
  for (const comp of incoming) {
    const key = comparableKey(comp);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(comp);
  }
  return result;
}

// --- Quality thresholds --------------------------------------------------

export const MIN_COMPARABLE_CONFIDENCE = 0.5;
export const MIN_USABLE_COMPARABLES = 3;

// Tier boundaries (Phase 10.3). NEAR_IDENTICAL_CONFIDENCE/VISUAL are
// deliberately strict — this tier means "point to this with confidence,"
// not just "cleared the usability bar." APPROXIMATE_CONFIDENCE_FLOOR mirrors
// providers/brave-discovery.ts's own Stage 2 shortlist floor: below it, a
// candidate was never even visually checked, so it isn't worth surfacing as
// anything but a weak match.
export const NEAR_IDENTICAL_CONFIDENCE = 0.8;
export const NEAR_IDENTICAL_VISUAL_SIMILARITY = 0.7;
export const APPROXIMATE_CONFIDENCE_FLOOR = 0.3;

export const COMPARABLE_TIERS = ["NEAR_IDENTICAL", "GOOD", "APPROXIMATE", "WEAK"] as const;
export type ComparableTier = (typeof COMPARABLE_TIERS)[number];

/** The only priceEvidence values that back a price with something we can actually point to. */
const TRUSTED_PRICE_EVIDENCE = new Set<string>(["STRUCTURED_DATA", "META_TAG", "MICRODATA"]);

interface QualityFields {
  source: "WEB_SEARCH" | "MANUAL";
  priceCents: number | null;
  matchConfidence: number | null;
  priceEvidence: string | null;
  visualSimilarity: number | null;
}

/**
 * Classifies a comp into one of four tiers instead of a flat usable/not-
 * usable split — "finding a listing is not enough; Sellstice should
 * determine how useful that listing actually is" (Phase 10.3). Built
 * entirely from signals the pipeline already computes (matchConfidence —
 * itself already a text/visual blend, see providers/brave-discovery.ts —
 * priceEvidence, visualSimilarity); no new AI extraction.
 *
 * A manual comp always lands at GOOD: the user is vouching for it directly
 * (see isUsableComparable's original reasoning, preserved here), so there's
 * no automated signal to grade it against, and it would be wrong to either
 * inflate it to NEAR_IDENTICAL (nothing confirmed that) or discount it below
 * an automated guess.
 *
 * NEAR_IDENTICAL requires all three axes to agree: a strong text match, a
 * verified price, AND an actual visual confirmation that agrees (not just
 * the absence of a visual check) — this is deliberately hard to reach.
 * GOOD is exactly today's pre-10.3 "usable" bar (confidence >= 0.5 + a
 * trusted price), given a name instead of a boolean. APPROXIMATE surfaces
 * comps with real but weaker signal, rather than treating them the same as
 * a near-zero-confidence WEAK match.
 */
export function classifyComparableTier(comp: QualityFields): ComparableTier {
  // A comp with no price at all can't inform pricing regardless of how well
  // it otherwise matches — this applies to manual comps too, matching
  // isUsableComparable's original priceCents check.
  if (comp.priceCents === null) return "WEAK";
  if (comp.source === "MANUAL") return "GOOD";

  const hasTrustedPrice = comp.priceEvidence !== null && TRUSTED_PRICE_EVIDENCE.has(comp.priceEvidence);
  const confidence = comp.matchConfidence ?? 0;

  if (
    hasTrustedPrice &&
    confidence >= NEAR_IDENTICAL_CONFIDENCE &&
    comp.visualSimilarity !== null &&
    comp.visualSimilarity >= NEAR_IDENTICAL_VISUAL_SIMILARITY
  ) {
    return "NEAR_IDENTICAL";
  }
  if (hasTrustedPrice && confidence >= MIN_COMPARABLE_CONFIDENCE) {
    return "GOOD";
  }
  if (confidence >= APPROXIMATE_CONFIDENCE_FLOOR) {
    return "APPROXIMATE";
  }
  return "WEAK";
}

/**
 * Equivalent to classifyComparableTier(comp) being NEAR_IDENTICAL or GOOD —
 * kept as its own function since most callers only care about the boolean,
 * not the specific tier.
 */
export function isUsableComparable(comp: QualityFields): boolean {
  const tier = classifyComparableTier(comp);
  return tier === "NEAR_IDENTICAL" || tier === "GOOD";
}

export interface ComparableQualityAssessment {
  usableCount: number;
  totalCount: number;
  tierCounts: Record<ComparableTier, number>;
  sufficient: boolean;
  reason: string;
}

/**
 * The deterministic gate behind "say 'not enough reliable comps' rather than
 * confidently recommend a bad price" — computed fresh over whatever comps
 * currently exist for an item (not cached), so it can't go stale as comps
 * are added or removed.
 */
export function assessComparableQuality(comps: QualityFields[]): ComparableQualityAssessment {
  const tierCounts: Record<ComparableTier, number> = {
    NEAR_IDENTICAL: 0,
    GOOD: 0,
    APPROXIMATE: 0,
    WEAK: 0,
  };
  for (const comp of comps) {
    tierCounts[classifyComparableTier(comp)] += 1;
  }
  const usableCount = tierCounts.NEAR_IDENTICAL + tierCounts.GOOD;
  const sufficient = usableCount >= MIN_USABLE_COMPARABLES;
  return {
    usableCount,
    totalCount: comps.length,
    tierCounts,
    sufficient,
    reason: sufficient
      ? `${tierCounts.NEAR_IDENTICAL} near-identical, ${tierCounts.GOOD} good comparable${tierCounts.GOOD === 1 ? "" : "s"} found.`
      : `Only ${usableCount} reliable comparable${usableCount === 1 ? "" : "s"} out of ${comps.length} found (need at least ${MIN_USABLE_COMPARABLES}). Treat any pricing guidance as low-confidence until more comps are available.`,
  };
}

// --- Normalization ---------------------------------------------------------

export function mapComparablesToCreateData(itemId: string, results: ComparableSearchResult[]) {
  return results.map((r) => ({
    itemId,
    source: "WEB_SEARCH" as const,
    title: r.title,
    marketplace: r.marketplace,
    priceCents: r.priceCents,
    priceType: r.priceType,
    url: r.url,
    condition: r.condition,
    recency: r.recency,
    matchConfidence: r.matchConfidence,
    priceEvidence: r.priceEvidence,
    imageUrl: r.imageUrl,
    visualSimilarity: r.visualSimilarity,
    rawMetadata: r,
  }));
}
