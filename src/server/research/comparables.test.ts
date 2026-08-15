import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deduplicateComparables,
  deduplicateAgainstExisting,
  assessComparableQuality,
  isUsableComparable,
  hasEnoughAttributesToResearch,
  mapComparablesToCreateData,
  getMarketResearchCooldownRemainingMs,
  MIN_COMPARABLE_CONFIDENCE,
  MIN_USABLE_COMPARABLES,
  MARKET_RESEARCH_COOLDOWN_MS,
} from "./comparables";
import type { ComparableSearchResult } from "./provider";

function comp(overrides: Partial<ComparableSearchResult> = {}): ComparableSearchResult {
  return {
    title: "Zara Cream Sweater Size M",
    marketplace: "Poshmark",
    priceCents: 2500,
    priceType: "ASKING",
    url: "https://poshmark.com/listing/abc123",
    condition: "Good",
    recency: "listed 3 days ago",
    confidence: 0.8,
    ...overrides,
  };
}

// --- Deduplication -------------------------------------------------------

test("deduplicateComparables keeps distinct listings", () => {
  const a = comp({ url: "https://a.com/1" });
  const b = comp({ url: "https://b.com/2" });
  assert.equal(deduplicateComparables([a, b]).length, 2);
});

test("deduplicateComparables drops an exact URL repeat", () => {
  const a = comp({ url: "https://poshmark.com/listing/abc123" });
  const b = comp({ url: "https://poshmark.com/listing/abc123", title: "Different title text" });
  const result = deduplicateComparables([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0], a);
});

test("deduplicateComparables treats URLs differing only by trailing slash or case as the same", () => {
  const a = comp({ url: "https://Poshmark.com/listing/abc123/" });
  const b = comp({ url: "https://poshmark.com/listing/abc123" });
  assert.equal(deduplicateComparables([a, b]).length, 1);
});

test("deduplicateComparables falls back to title+marketplace+price signature when no URL", () => {
  const a = comp({ url: null, title: "Zara Cream Sweater", marketplace: "eBay", priceCents: 1800 });
  const b = comp({ url: null, title: "  zara   cream sweater  ", marketplace: "ebay", priceCents: 1800 });
  assert.equal(deduplicateComparables([a, b]).length, 1);
});

test("deduplicateComparables keeps two listings with no URL but different prices", () => {
  const a = comp({ url: null, priceCents: 1800 });
  const b = comp({ url: null, priceCents: 2200 });
  assert.equal(deduplicateComparables([a, b]).length, 2);
});

test("deduplicateAgainstExisting filters out a comp already stored", () => {
  const existing = [{ url: "https://poshmark.com/listing/abc123", title: "x", marketplace: null, priceCents: null }];
  const incoming = [comp({ url: "https://poshmark.com/listing/abc123" }), comp({ url: "https://new.com/1" })];
  const result = deduplicateAgainstExisting(existing, incoming);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://new.com/1");
});

test("deduplicateAgainstExisting keeps everything when nothing overlaps", () => {
  const existing = [{ url: "https://a.com/1", title: "x", marketplace: null, priceCents: null }];
  const incoming = [comp({ url: "https://b.com/2" })];
  assert.equal(deduplicateAgainstExisting(existing, incoming).length, 1);
});

// --- Quality thresholds ----------------------------------------------------

test("isUsableComparable requires both a price and confidence at/above the bar for web-search comps", () => {
  assert.equal(isUsableComparable({ source: "WEB_SEARCH", priceCents: 2000, confidence: MIN_COMPARABLE_CONFIDENCE }), true);
  assert.equal(isUsableComparable({ source: "WEB_SEARCH", priceCents: null, confidence: 0.9 }), false);
  assert.equal(isUsableComparable({ source: "WEB_SEARCH", priceCents: 2000, confidence: null }), false);
  assert.equal(isUsableComparable({ source: "WEB_SEARCH", priceCents: 2000, confidence: MIN_COMPARABLE_CONFIDENCE - 0.01 }), false);
});

test("isUsableComparable trusts a manual comp with a price regardless of (null) confidence", () => {
  assert.equal(isUsableComparable({ source: "MANUAL", priceCents: 2000, confidence: null }), true);
  assert.equal(isUsableComparable({ source: "MANUAL", priceCents: null, confidence: null }), false);
});

test("assessComparableQuality: manual entries can push an otherwise-insufficient set over the threshold", () => {
  const weakAutomated = [
    { source: "WEB_SEARCH" as const, priceCents: 1500, confidence: 0.2 },
  ];
  const manual = Array.from({ length: MIN_USABLE_COMPARABLES }, () => ({
    source: "MANUAL" as const,
    priceCents: 2000,
    confidence: null,
  }));
  const result = assessComparableQuality([...weakAutomated, ...manual]);
  assert.equal(result.usableCount, MIN_USABLE_COMPARABLES);
  assert.equal(result.sufficient, true);
});

test("assessComparableQuality reports insufficient below the minimum usable count", () => {
  const comps = [
    { source: "WEB_SEARCH" as const, priceCents: 2000, confidence: 0.9 },
    { source: "WEB_SEARCH" as const, priceCents: 1800, confidence: 0.6 },
  ];
  const result = assessComparableQuality(comps);
  assert.equal(result.usableCount, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.sufficient, false);
  assert.match(result.reason, /Only 2 reliable comparable/);
});

test("assessComparableQuality reports sufficient exactly at the minimum usable count", () => {
  const comps = Array.from({ length: MIN_USABLE_COMPARABLES }, () => ({
    source: "WEB_SEARCH" as const,
    priceCents: 2000,
    confidence: 0.9,
  }));
  const result = assessComparableQuality(comps);
  assert.equal(result.usableCount, MIN_USABLE_COMPARABLES);
  assert.equal(result.sufficient, true);
});

test("assessComparableQuality: 10 found but only 2 reliable is still insufficient (the exact scenario to avoid)", () => {
  const weak = Array.from({ length: 8 }, () => ({
    source: "WEB_SEARCH" as const,
    priceCents: 1500,
    confidence: 0.2,
  }));
  const strong = [
    { source: "WEB_SEARCH" as const, priceCents: 2000, confidence: 0.9 },
    { source: "WEB_SEARCH" as const, priceCents: 2100, confidence: 0.85 },
  ];
  const result = assessComparableQuality([...weak, ...strong]);
  assert.equal(result.totalCount, 10);
  assert.equal(result.usableCount, 2);
  assert.equal(result.sufficient, false);
});

test("assessComparableQuality ignores comps with unknown price even at high confidence", () => {
  const comps = [
    { source: "WEB_SEARCH" as const, priceCents: null, confidence: 0.95 },
    { source: "WEB_SEARCH" as const, priceCents: null, confidence: 0.95 },
    { source: "WEB_SEARCH" as const, priceCents: null, confidence: 0.95 },
  ];
  const result = assessComparableQuality(comps);
  assert.equal(result.usableCount, 0);
  assert.equal(result.sufficient, false);
});

// --- Attribute guard -------------------------------------------------------

test("hasEnoughAttributesToResearch requires at least brand or category", () => {
  assert.equal(hasEnoughAttributesToResearch({ brand: "Zara", color: null, category: null, size: null, condition: null }), true);
  assert.equal(hasEnoughAttributesToResearch({ brand: null, color: null, category: "Sweater", size: null, condition: null }), true);
  assert.equal(hasEnoughAttributesToResearch({ brand: null, color: "Cream", category: null, size: "M", condition: null }), false);
  assert.equal(hasEnoughAttributesToResearch({ brand: null, color: null, category: null, size: null, condition: null }), false);
});

// --- Normalization -----------------------------------------------------

test("mapComparablesToCreateData tags every result as WEB_SEARCH, attaches itemId, and preserves raw metadata", () => {
  const result = comp();
  const [data] = mapComparablesToCreateData("item_123", [result]);
  assert.equal(data.itemId, "item_123");
  assert.equal(data.source, "WEB_SEARCH");
  assert.equal(data.title, result.title);
  assert.equal(data.priceCents, result.priceCents);
  assert.equal(data.priceType, result.priceType);
  assert.deepEqual(data.rawMetadata, result);
});

test("mapComparablesToCreateData passes through nulls untouched", () => {
  const result = comp({ marketplace: null, priceCents: null, url: null, condition: null, recency: null });
  const [data] = mapComparablesToCreateData("item_123", [result]);
  assert.equal(data.marketplace, null);
  assert.equal(data.priceCents, null);
  assert.equal(data.url, null);
});

// --- Cooldown ------------------------------------------------------------

test("no cooldown when the item has never been researched", () => {
  assert.equal(getMarketResearchCooldownRemainingMs(null, new Date()), 0);
});

test("blocks a re-run immediately after a previous one", () => {
  const now = new Date("2026-01-01T00:00:20.000Z");
  const lastRunAt = new Date("2026-01-01T00:00:00.000Z");
  const remaining = getMarketResearchCooldownRemainingMs(lastRunAt, now);
  assert.equal(remaining, MARKET_RESEARCH_COOLDOWN_MS - 20_000);
  assert.ok(remaining > 0);
});
