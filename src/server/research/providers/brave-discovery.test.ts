import { test } from "node:test";
import assert from "node:assert/strict";
import { BraveDiscoveryComparableProvider } from "./brave-discovery";
import type { DiscoveredCandidate } from "../discovery/types";
import type { ComparableCandidate, ComparableSearchResult, MarketResearchQuery } from "../provider";
import type { MatchJudgment } from "../discovery/match-candidates";
import type { VisualMatchJudgment } from "../discovery/match-candidates-visual";
import type { ImageFetchResult } from "../enrichment/fetch-image";
import type { ImageInput } from "@/server/ai";

function itemPhotos(): ImageInput[] {
  return [{ base64: "item-photo-bytes", mediaType: "image/jpeg" }];
}

/** enrich stub that stamps every candidate with a given imageUrl and a fixed price. */
function enrichWith(imageUrl: string | null) {
  return async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({
      ...c,
      priceCents: 2500,
      priceEvidence: "STRUCTURED_DATA" as const,
      priceEvidenceDetail: null,
      availabilitySignal: null,
      imageUrl,
      visualSimilarity: null,
    }));
}

function query(): MarketResearchQuery {
  return { brand: "Zara", color: "Green", category: "Hoodie", size: null, condition: null, notableDetails: null };
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
    candidates.map((c) => ({
      ...c,
      priceCents: 2500,
      priceEvidence: "STRUCTURED_DATA" as const,
      priceEvidenceDetail: null,
      availabilitySignal: null,
      visualSimilarity: null,
    }));
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
    candidates.map((c) => ({ ...c, priceCents: null, priceEvidence: "UNVERIFIED" as const, priceEvidenceDetail: null, availabilitySignal: null, visualSimilarity: null }));

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
    return candidates.map((c) => ({ ...c, priceCents: null, priceEvidence: "UNVERIFIED" as const, priceEvidenceDetail: null, availabilitySignal: null, visualSimilarity: null }));
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
    candidates.map((c) => ({ ...c, priceCents: null, priceEvidence: "UNVERIFIED" as const, priceEvidenceDetail: null, availabilitySignal: null, visualSimilarity: null }));
  const match = async (): Promise<MatchJudgment[]> => {
    throw new Error("matching failed");
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  await assert.rejects(() => provider.findComparables(query()), /matching failed/);
});

// --- SOLD priceType reconciliation (Phase 10.4) ---------------------------
//
// matchCandidates only ever sees a title/snippet — a SOLD priceType from it
// is still just a text judgment, exactly what comparableCandidateSchema's
// priceType doc comment warns against trusting alone. These pin down that
// the page's own deterministic availability signal (enrichComparables, via
// extract-price.ts) is actually consulted, live-verified against real
// Poshmark markup on the extract-price.ts side.

test("an AI-claimed SOLD priceType is downgraded to UNKNOWN when the page's own availability says otherwise", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({
      ...c,
      priceCents: 2500,
      priceEvidence: "STRUCTURED_DATA" as const,
      priceEvidenceDetail: null,
      availabilitySignal: "AVAILABLE" as const,
      visualSimilarity: null,
    }));
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "SOLD", condition: "Good", recency: "sold 2 days ago" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  const [result] = await provider.findComparables(query());
  assert.equal(result.priceType, "UNKNOWN");
});

test("a SOLD priceType is left alone when the page's availability confirms it", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({
      ...c,
      priceCents: 2500,
      priceEvidence: "STRUCTURED_DATA" as const,
      priceEvidenceDetail: null,
      availabilitySignal: "SOLD" as const,
      visualSimilarity: null,
    }));
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "SOLD", condition: "Good", recency: "sold 2 days ago" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  const [result] = await provider.findComparables(query());
  assert.equal(result.priceType, "SOLD");
});

test("a SOLD priceType is left alone when there is no availability signal at all (no unearned confidence either way)", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({
      ...c,
      priceCents: null,
      priceEvidence: "BLOCKED" as const,
      priceEvidenceDetail: "HTTP 403",
      availabilitySignal: null,
      visualSimilarity: null,
    }));
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "SOLD", condition: "Good", recency: "sold 2 days ago" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  const [result] = await provider.findComparables(query());
  assert.equal(result.priceType, "SOLD");
});

test("an ASKING priceType is never touched by the availability check, even when availability contradicts it", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c) => ({
      ...c,
      priceCents: 2500,
      priceEvidence: "STRUCTURED_DATA" as const,
      priceEvidenceDetail: null,
      availabilitySignal: "SOLD" as const,
      visualSimilarity: null,
    }));
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: "Good", recency: "listed 3 days ago" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match });
  const [result] = await provider.findComparables(query());
  assert.equal(result.priceType, "ASKING");
});

// --- Stage 2 (visual confirmation) --------------------------------------

test("Stage 2 never runs when no item photos are supplied", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith("https://vinted.com/photo.jpg");
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: null, recency: null },
  ];
  let matchVisualCalled = false;
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => {
    matchVisualCalled = true;
    return [];
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual });
  const result = await provider.findComparables(query()); // no itemPhotos arg

  assert.equal(matchVisualCalled, false);
  assert.equal(result[0].matchConfidence, 0.9);
  assert.equal(result[0].visualSimilarity, null);
});

test("a visual mismatch caps matchConfidence down via min(), never inflates it", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith("https://vinted.com/photo.jpg");
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: null, recency: null },
  ];
  const fetchImage = async (): Promise<ImageFetchResult> => ({
    status: "ok",
    base64: "candidate-bytes",
    mediaType: "image/jpeg",
  });
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => [
    { index: 0, visualSimilarity: 0.2, rationale: "different graphic print" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual, fetchImage });
  const result = await provider.findComparables(query(), itemPhotos());

  assert.equal(result[0].matchConfidence, 0.2, "final confidence must be capped to the lower visual score");
  assert.equal(result[0].visualSimilarity, 0.2);
});

test("a visual confirmation does not inflate matchConfidence above Stage 1's score", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith("https://vinted.com/photo.jpg");
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.4, priceType: "ASKING", condition: null, recency: null },
  ];
  const fetchImage = async (): Promise<ImageFetchResult> => ({
    status: "ok",
    base64: "candidate-bytes",
    mediaType: "image/jpeg",
  });
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => [
    { index: 0, visualSimilarity: 0.95, rationale: "looks identical" },
  ];

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual, fetchImage });
  const result = await provider.findComparables(query(), itemPhotos());

  assert.equal(result[0].matchConfidence, 0.4, "a strong visual score must not raise a weak text score");
});

test("a candidate below the Stage 1 floor is excluded from the visual shortlist", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith("https://vinted.com/photo.jpg");
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.1, priceType: "ASKING", condition: null, recency: null },
  ];
  let fetchImageCalled = false;
  const fetchImage = async (): Promise<ImageFetchResult> => {
    fetchImageCalled = true;
    return { status: "ok", base64: "x", mediaType: "image/jpeg" };
  };
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => {
    throw new Error("should not be called");
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual, fetchImage });
  const result = await provider.findComparables(query(), itemPhotos());

  assert.equal(fetchImageCalled, false);
  assert.equal(result[0].matchConfidence, 0.1);
  assert.equal(result[0].visualSimilarity, null);
});

test("a candidate with no extracted image is excluded from the visual shortlist", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith(null);
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: null, recency: null },
  ];
  let matchVisualCalled = false;
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => {
    matchVisualCalled = true;
    return [];
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual });
  const result = await provider.findComparables(query(), itemPhotos());

  assert.equal(matchVisualCalled, false);
  assert.equal(result[0].matchConfidence, 0.9);
});

test("a failed image fetch excludes that candidate from Stage 2 but keeps its Stage 1 score", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith("https://vinted.com/photo.jpg");
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: null, recency: null },
  ];
  const fetchImage = async (): Promise<ImageFetchResult> => ({ status: "blocked", reason: "403" });
  let matchVisualCalled = false;
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => {
    matchVisualCalled = true;
    return [];
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual, fetchImage });
  const result = await provider.findComparables(query(), itemPhotos());

  assert.equal(matchVisualCalled, false);
  assert.equal(result[0].matchConfidence, 0.9);
  assert.equal(result[0].visualSimilarity, null);
});

test("Stage 2 failure degrades gracefully to Stage 1-only scores rather than throwing", async () => {
  const discover = async (): Promise<DiscoveredCandidate[]> => [discovered()];
  const enrich = enrichWith("https://vinted.com/photo.jpg");
  const match = async (): Promise<MatchJudgment[]> => [
    { matchConfidence: 0.9, priceType: "ASKING", condition: null, recency: null },
  ];
  const fetchImage = async (): Promise<ImageFetchResult> => ({
    status: "ok",
    base64: "x",
    mediaType: "image/jpeg",
  });
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => {
    throw new Error("vision call failed");
  };

  const provider = new BraveDiscoveryComparableProvider({ discover, enrich, match, matchVisual, fetchImage });
  const result = await provider.findComparables(query(), itemPhotos());

  assert.equal(result[0].matchConfidence, 0.9, "must fall back to Stage 1's score, not throw or drop the candidate");
  assert.equal(result[0].visualSimilarity, null);
});

test("caps the visual shortlist at 10 candidates, preferring the highest Stage 1 confidence", async () => {
  const discovered12 = Array.from({ length: 12 }, (_, i) =>
    discovered({ url: `https://www.vinted.com/items/${i}` }),
  );
  const discover = async (): Promise<DiscoveredCandidate[]> => discovered12;
  const match = async (): Promise<MatchJudgment[]> =>
    // Descending confidence: candidate 0 highest, candidate 11 lowest, all above the 0.3 floor.
    discovered12.map((_, i) => ({
      matchConfidence: 0.9 - i * 0.05,
      priceType: "ASKING" as const,
      condition: null,
      recency: null,
    }));
  const fetchedIndexes: number[] = [];
  const fetchImage = async (url: string): Promise<ImageFetchResult> => {
    fetchedIndexes.push(Number(url));
    return { status: "ok", base64: "x", mediaType: "image/jpeg" };
  };
  const matchVisual = async (): Promise<VisualMatchJudgment[]> => [];

  // fetchImage receives candidates[i].imageUrl, which is the same fixed
  // string for every candidate here — swap enrich to encode the index in
  // the URL so the test can tell which candidates were actually fetched.
  const enrichIndexed = async (candidates: ComparableCandidate[]): Promise<ComparableSearchResult[]> =>
    candidates.map((c, i) => ({
      ...c,
      priceCents: 2500,
      priceEvidence: "STRUCTURED_DATA" as const,
      priceEvidenceDetail: null,
      availabilitySignal: null,
      imageUrl: String(i),
      visualSimilarity: null,
    }));

  const provider = new BraveDiscoveryComparableProvider({
    discover,
    enrich: enrichIndexed,
    match,
    matchVisual,
    fetchImage,
  });
  await provider.findComparables(query(), itemPhotos());

  assert.equal(fetchedIndexes.length, 10, "shortlist must be capped at 10");
  assert.deepEqual(
    [...fetchedIndexes].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "must keep the 10 highest-confidence candidates (0-9), not the lowest",
  );
});
