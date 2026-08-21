import {
  classifyComparableTier,
  MIN_USABLE_COMPARABLES,
  type ComparableTier,
  type QualityFields,
} from "./comparables";

/**
 * Weight given to each tier's price when computing weighted percentiles
 * (Phase 10.5) — "the recommendation should account for comparable quality
 * rather than blindly averaging every discovered price." A NEAR_IDENTICAL
 * comp counts for more than a GOOD one, which counts for more than an
 * APPROXIMATE one; WEAK comps carry no price signal at all (matches
 * classifyComparableTier's own verdict that a WEAK match isn't worth
 * pricing from) and are excluded before any percentile math runs.
 */
const TIER_WEIGHT: Record<ComparableTier, number> = {
  NEAR_IDENTICAL: 3,
  GOOD: 2,
  APPROXIMATE: 1,
  WEAK: 0,
};

/** Above this ratio of (range high - range low) / median, the comps disagree
 * too much with each other to call the recommendation high-confidence even
 * if there are enough of them. */
export const HIGH_CONFIDENCE_SPREAD_RATIO = 0.4;

export interface PriceRecommendationInput extends QualityFields {
  priceCents: number | null;
}

export type PriceRecommendationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface PriceRecommendation {
  sampleSize: number;
  tierCounts: Record<ComparableTier, number>;
  comparablePriceRangeLowCents: number;
  comparablePriceRangeHighCents: number;
  medianComparablePriceCents: number;
  recommendedListingPriceCents: number;
  recommendedMinimumAcceptablePriceCents: number;
  quickSalePriceCents: number;
  waitForBuyerPriceCents: number;
  confidence: PriceRecommendationConfidence;
}

interface WeightedPrice {
  priceCents: number;
  weight: number;
}

/** `sorted` must already be ascending by priceCents. Percentiles are
 * monotonic non-decreasing in `p` by construction, which is what keeps
 * minimumAcceptable <= quickSale <= median <= listing <= waitForBuyer
 * ordered without needing to special-case it. */
function weightedPercentile(sorted: WeightedPrice[], totalWeight: number, p: number): number {
  const target = p * totalWeight;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= target) return entry.priceCents;
  }
  return sorted[sorted.length - 1].priceCents;
}

const roundToDollar = (cents: number): number => Math.round(cents / 100) * 100;

/**
 * Turns a comp list into pricing guidance (Phase 10.5): a comparable price
 * range, a median, and four suggested price points spanning "sell fast" to
 * "hold out for a better offer" — all derived from the same tier weighting,
 * so they stay ordered quickSale <= listing <= waitForBuyer by construction.
 *
 * Deliberately deterministic, no LLM call: every input (tier, price) is
 * already computed by the pipeline, so this is arithmetic over existing
 * signals rather than a new judgment call.
 *
 * Returns null when there's nothing priced to compute from (no comp has
 * both a price and a non-WEAK tier) — callers should treat that the same as
 * "no recommendation available yet," not as a zero-priced comp.
 */
export function computePriceRecommendation(comps: PriceRecommendationInput[]): PriceRecommendation | null {
  const tierCounts: Record<ComparableTier, number> = {
    NEAR_IDENTICAL: 0,
    GOOD: 0,
    APPROXIMATE: 0,
    WEAK: 0,
  };
  const weighted: WeightedPrice[] = [];
  for (const comp of comps) {
    const tier = classifyComparableTier(comp);
    tierCounts[tier] += 1;
    if (comp.priceCents !== null && TIER_WEIGHT[tier] > 0) {
      weighted.push({ priceCents: comp.priceCents, weight: TIER_WEIGHT[tier] });
    }
  }

  if (weighted.length === 0) return null;

  weighted.sort((a, b) => a.priceCents - b.priceCents);
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

  const comparablePriceRangeLowCents = weighted[0].priceCents;
  const comparablePriceRangeHighCents = weighted[weighted.length - 1].priceCents;
  const medianComparablePriceCents = weightedPercentile(weighted, totalWeight, 0.5);

  const usableCount = tierCounts.NEAR_IDENTICAL + tierCounts.GOOD;
  const spreadRatio =
    medianComparablePriceCents > 0
      ? (comparablePriceRangeHighCents - comparablePriceRangeLowCents) / medianComparablePriceCents
      : 0;

  let confidence: PriceRecommendationConfidence;
  if (usableCount >= MIN_USABLE_COMPARABLES && spreadRatio <= HIGH_CONFIDENCE_SPREAD_RATIO) {
    confidence = "HIGH";
  } else if (usableCount >= 1 || weighted.length >= MIN_USABLE_COMPARABLES) {
    confidence = "MEDIUM";
  } else {
    confidence = "LOW";
  }

  return {
    sampleSize: weighted.length,
    tierCounts,
    comparablePriceRangeLowCents,
    comparablePriceRangeHighCents,
    medianComparablePriceCents: roundToDollar(medianComparablePriceCents),
    recommendedListingPriceCents: roundToDollar(weightedPercentile(weighted, totalWeight, 0.65)),
    recommendedMinimumAcceptablePriceCents: roundToDollar(weightedPercentile(weighted, totalWeight, 0.15)),
    quickSalePriceCents: roundToDollar(weightedPercentile(weighted, totalWeight, 0.3)),
    waitForBuyerPriceCents: roundToDollar(weightedPercentile(weighted, totalWeight, 0.85)),
    confidence,
  };
}
