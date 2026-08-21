import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessSellTiming,
  buildGoalSignal,
  summarizeComparablesForSellTiming,
  SellTimingProviderError,
  type ComparableSignalInput,
  type SellTimingSignals,
} from "./sell-timing";

function comp(overrides: Partial<ComparableSignalInput> = {}): ComparableSignalInput {
  return {
    source: "WEB_SEARCH",
    priceCents: 2500,
    matchConfidence: 0.85,
    priceEvidence: "STRUCTURED_DATA",
    visualSimilarity: null,
    marketplace: "Poshmark",
    priceType: "ASKING",
    ...overrides,
  };
}

// --- summarizeComparablesForSellTiming --------------------------------------

test("summarizeComparablesForSellTiming counts marketplaces, sold, and asking", () => {
  const comps = [
    comp({ marketplace: "Poshmark", priceType: "ASKING" }),
    comp({ marketplace: "Poshmark", priceType: "SOLD" }),
    comp({ marketplace: "Depop", priceType: "SOLD" }),
    comp({ marketplace: null, priceType: "UNKNOWN", priceCents: null }),
  ];
  const summary = summarizeComparablesForSellTiming(comps);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.distinctMarketplaceCount, 2);
  assert.equal(summary.soldCount, 2);
  assert.equal(summary.askingCount, 1);
});

test("summarizeComparablesForSellTiming returns a null priceRecommendation with no priced comps", () => {
  const summary = summarizeComparablesForSellTiming([comp({ priceCents: null, matchConfidence: 0.1 })]);
  assert.equal(summary.priceRecommendation, null);
});

test("summarizeComparablesForSellTiming reuses tier classification for tierCounts", () => {
  const summary = summarizeComparablesForSellTiming([comp({ matchConfidence: 0.9 })]);
  assert.equal(summary.tierCounts.GOOD, 1);
  assert.equal(summary.usableCount, 1);
});

// --- buildGoalSignal -----------------------------------------------------

test("buildGoalSignal returns null with no goal", () => {
  assert.equal(buildGoalSignal(null, new Date("2026-08-21")), null);
});

test("buildGoalSignal computes days remaining", () => {
  const signal = buildGoalSignal(
    { targetAmountCents: 100_000, deadline: new Date("2026-09-10") },
    new Date("2026-08-21"),
  )!;
  assert.equal(signal.daysRemaining, 20);
  assert.equal(signal.deadlinePassed, false);
});

test("buildGoalSignal clamps a past deadline to zero days remaining and flags it passed", () => {
  const signal = buildGoalSignal(
    { targetAmountCents: 50_000, deadline: new Date("2026-08-01") },
    new Date("2026-08-21"),
  )!;
  assert.equal(signal.daysRemaining, 0);
  assert.equal(signal.deadlinePassed, true);
});

// --- assessSellTiming ------------------------------------------------------

function signals(overrides: Partial<SellTimingSignals> = {}): SellTimingSignals {
  return {
    brand: "Lululemon",
    category: "Leggings",
    condition: "GOOD",
    comparables: summarizeComparablesForSellTiming([comp()]),
    goal: null,
    now: new Date("2026-08-21"),
    ...overrides,
  };
}

test("assessSellTiming returns the parsed judgment on success", async () => {
  const parse = async () => ({
    stop_reason: "end_turn",
    parsed_output: { stance: "SELL_NOW" as const, confidence: 0.7, explanation: "Strong demand right now." },
  });
  const result = await assessSellTiming(signals(), { parse });
  assert.equal(result.stance, "SELL_NOW");
  assert.equal(result.confidence, 0.7);
});

test("assessSellTiming throws on a refusal stop reason", async () => {
  const parse = async () => ({ stop_reason: "refusal", parsed_output: null });
  await assert.rejects(() => assessSellTiming(signals(), { parse }), SellTimingProviderError);
});

test("assessSellTiming throws when parsed_output is null", async () => {
  const parse = async () => ({ stop_reason: "end_turn", parsed_output: null });
  await assert.rejects(() => assessSellTiming(signals(), { parse }), SellTimingProviderError);
});

test("assessSellTiming wraps an underlying call failure into SellTimingProviderError", async () => {
  const parse = async () => {
    throw new Error("network down");
  };
  await assert.rejects(() => assessSellTiming(signals(), { parse }), SellTimingProviderError);
});
