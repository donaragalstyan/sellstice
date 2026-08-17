import { test } from "node:test";
import assert from "node:assert/strict";
import { BraveDiscoveryComparableProvider } from "./brave-discovery";
import type { DiscoveredCandidate } from "../discovery/types";
import type { ComparableCandidate, ComparableSearchResult, MarketResearchQuery } from "../provider";
import type { MatchJudgment } from "../discovery/match-candidates";

function query(): MarketResearchQuery {
  return { brand: "Zara", color: "Green", category: "Hoodie", size: null, condition: null };
}

function discovered(overrides: Partial<DiscoveredCandidate> = {}): DiscoveredCandidate {
  return {
    marketplace: "vinted.com",
    title: "Zara Green Hoodie",
    url: "https://www.vinted.com/items/1-zara-green-hoodie",
    snippet: "worn twice",
    sourceRank: 1,
    ...overrides,
  };
}

test("full pipeline merges enrichment's price with matching's judgment", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({ ...c, priceCents: 2500, priceEvidence: "STRUCTURED_DATA" as const }));
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: "Good", recency: "listed 3 days ago" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  const result = await provider.findComparables(query());

  assert.equal(result.length, 1);
  assert.equal(result[0].priceCents, 2500);
  assert.equal(result[0].priceEvidence, "STRUCTURED_DATA");
  assert.equal(result[0].matchConfidence, 0.9);
  assert.equal(result[0].priceType, "ASKING");
  assert.equal(result[0].condition, "Good");
  assert.equal(result[0].recency, "listed 3 days ago");
  // Placeholder values must never leak through once a judgment is present.
  assert.notEqual(result[0].matchConfidence, 0);
  assert.notEqual(result[0].priceType, "UNKNOWN");
});

test("passes the discovery snippet through to the matching step", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered({ snippet: "size M, worn once" })];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({ ...c, priceCents: null, priceEvidence: "UNVERIFIED" as const }));

  let receivedSnippet: string | null | undefined;
  const match = async (_q: MarketResearchQuery, candidates: { snippet: string | null }[]): Promise<MatchJudgment[]> => {
    receivedSnippet = candidates[0].snippet;
    return [{ matchConfidence: 0.5, priceType: "UNKNOWN", condition: null, recency: null }];
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  await provider.findComparables(query());
  assert.equal(receivedSnippet, "size M, worn once");
});

test("empty discovery result skips enrichment and matching entirely", async () => {
  let enrichCalled = false;
  let matchCalled = false;
  const discover = async (): Promise<DiscoveredCandidate[]> => [];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> => {
    enrichCalled = true;
    return candidates.map((c) => ({ ...c, priceCents: null, priceEvidence: "UNVERIFIED" as const }));
  };
  const match = async (): Promise<MatchJudgment[]> => {
    matchCalled = true;
    return [];
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  const result = await provider.findComparables(query());

  assert.deepEqual(result, []);
  assert.equal(enrichCalled, false);
  assert.equal(matchCalled, false);
});

test("a matching-step failure propagates out of findComparables", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({ ...c, priceCents: null, priceEvidence: "UNVERIFIED" as const }));
  const match = async (): Promise<MatchJudgment[]> => {
    throw new Error("matching failed");
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  await assert.rejects(() => provider.findComparables(query()), /matching failed/);
});
