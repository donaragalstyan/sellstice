import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePriceRecommendation,
  HIGH_CONFIDENCE_SPREAD_RATIO,
  type PriceRecommendationInput,
} from "./price-recommendation";
import { MIN_USABLE_COMPARABLES } from "./comparables";

function comp(overrides: Partial<PriceRecommendationInput> = {}): PriceRecommendationInput {
  return {
    source: "WEB_SEARCH",
    priceCents: 2000,
    matchConfidence: 0.9,
    priceEvidence: "STRUCTURED_DATA",
    visualSimilarity: null,
    ...overrides,
  };
}

// --- No usable input -------------------------------------------------------

test("computePriceRecommendation returns null with no comps", () => {
  assert.equal(computePriceRecommendation([]), null);
});

test("computePriceRecommendation returns null when every comp is WEAK", () => {
  const comps = [comp({ priceCents: null }), comp({ matchConfidence: 0.1 })];
  assert.equal(computePriceRecommendation(comps), null);
});

test("computePriceRecommendation ignores WEAK comps but uses the rest", () => {
  const comps = [
    comp({ priceCents: 5000, matchConfidence: 0.9 }), // GOOD
    comp({ priceCents: 999_999, matchConfidence: 0.1 }), // WEAK — must not skew the range
  ];
  const rec = computePriceRecommendation(comps)!;
  assert.equal(rec.sampleSize, 1);
  assert.equal(rec.comparablePriceRangeHighCents, 5000);
});

// --- Single comp -------------------------------------------------------

test("computePriceRecommendation collapses every price point to the same value for a single comp", () => {
  const rec = computePriceRecommendation([comp({ priceCents: 3000 })])!;
  assert.equal(rec.comparablePriceRangeLowCents, 3000);
  assert.equal(rec.comparablePriceRangeHighCents, 3000);
  assert.equal(rec.medianComparablePriceCents, 3000);
  assert.equal(rec.recommendedListingPriceCents, 3000);
  assert.equal(rec.recommendedMinimumAcceptablePriceCents, 3000);
  assert.equal(rec.quickSalePriceCents, 3000);
  assert.equal(rec.waitForBuyerPriceCents, 3000);
});

// --- Ordering ----------------------------------------------------------

test("computePriceRecommendation keeps price points ordered low to high", () => {
  const comps = [
    comp({ priceCents: 1500, matchConfidence: 0.9 }),
    comp({ priceCents: 2200, matchConfidence: 0.6 }),
    comp({ priceCents: 3100, matchConfidence: 0.4 }),
    comp({ priceCents: 4000, matchConfidence: 0.9, priceEvidence: null }), // APPROXIMATE
  ];
  const rec = computePriceRecommendation(comps)!;
  assert.ok(rec.comparablePriceRangeLowCents <= rec.recommendedMinimumAcceptablePriceCents);
  assert.ok(rec.recommendedMinimumAcceptablePriceCents <= rec.quickSalePriceCents);
  assert.ok(rec.quickSalePriceCents <= rec.medianComparablePriceCents);
  assert.ok(rec.medianComparablePriceCents <= rec.recommendedListingPriceCents);
  assert.ok(rec.recommendedListingPriceCents <= rec.waitForBuyerPriceCents);
  assert.ok(rec.waitForBuyerPriceCents <= rec.comparablePriceRangeHighCents);
});

// --- Tier weighting ------------------------------------------------------

test("computePriceRecommendation pulls the median toward the higher-weighted tier", () => {
  const nearIdentical = comp({
    priceCents: 10_000,
    matchConfidence: 0.95,
    priceEvidence: "STRUCTURED_DATA",
    visualSimilarity: 0.9,
  }); // weight 3
  const approximate = comp({ priceCents: 1000, matchConfidence: 0.35, priceEvidence: null }); // weight 1
  const rec = computePriceRecommendation([nearIdentical, approximate])!;
  // 3 parts of 10000 to 1 part of 1000 should land the median well above the midpoint.
  assert.ok(rec.medianComparablePriceCents > 5500);
});

test("computePriceRecommendation counts tiers across all comps, including WEAK ones", () => {
  const comps = [
    comp({ priceCents: 5000, matchConfidence: 0.9 }), // GOOD
    comp({ priceCents: null }), // WEAK
  ];
  const rec = computePriceRecommendation(comps)!;
  assert.equal(rec.tierCounts.GOOD, 1);
  assert.equal(rec.tierCounts.WEAK, 1);
});

// --- Confidence ----------------------------------------------------------

test("computePriceRecommendation reports LOW confidence for a single approximate comp", () => {
  const rec = computePriceRecommendation([
    comp({ priceCents: 2000, matchConfidence: 0.35, priceEvidence: null }),
  ])!;
  assert.equal(rec.confidence, "LOW");
});

test("computePriceRecommendation reports MEDIUM confidence with one usable comp", () => {
  const rec = computePriceRecommendation([comp({ priceCents: 2000, matchConfidence: 0.9 })])!;
  assert.equal(rec.confidence, "MEDIUM");
});

test("computePriceRecommendation reports MEDIUM confidence with enough approximate comps but no usable ones", () => {
  const comps = Array.from({ length: MIN_USABLE_COMPARABLES }, () =>
    comp({ priceCents: 2000, matchConfidence: 0.35, priceEvidence: null }),
  );
  const rec = computePriceRecommendation(comps)!;
  assert.equal(rec.confidence, "MEDIUM");
});

test("computePriceRecommendation reports HIGH confidence with enough usable comps in a tight price band", () => {
  const comps = Array.from({ length: MIN_USABLE_COMPARABLES }, (_, i) =>
    comp({ priceCents: 2000 + i * 10, matchConfidence: 0.9 }),
  );
  const rec = computePriceRecommendation(comps)!;
  assert.equal(rec.confidence, "HIGH");
});

test("computePriceRecommendation downgrades to MEDIUM when usable comps disagree too widely", () => {
  const comps = [
    comp({ priceCents: 1000, matchConfidence: 0.9 }),
    comp({ priceCents: 1000, matchConfidence: 0.9 }),
    comp({ priceCents: 1000 + Math.round(1000 * (HIGH_CONFIDENCE_SPREAD_RATIO + 0.5)), matchConfidence: 0.9 }),
  ];
  const rec = computePriceRecommendation(comps)!;
  assert.equal(rec.tierCounts.GOOD + rec.tierCounts.NEAR_IDENTICAL >= MIN_USABLE_COMPARABLES, true);
  assert.equal(rec.confidence, "MEDIUM");
});

// --- Manual comps --------------------------------------------------------

test("computePriceRecommendation treats a manual comp as GOOD-weighted regardless of confidence fields", () => {
  const manual = comp({ source: "MANUAL", priceCents: 4000, matchConfidence: null, priceEvidence: null });
  const rec = computePriceRecommendation([manual])!;
  assert.equal(rec.tierCounts.GOOD, 1);
  assert.equal(rec.medianComparablePriceCents, 4000);
});
