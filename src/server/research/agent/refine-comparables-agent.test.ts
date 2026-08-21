import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRefinementTools, MAX_REFINEMENT_RETRIES, type RefinementAgentDeps } from "./refine-comparables-agent";
import type { QualityFields } from "../comparables";
import type { ComparableSearchResult, MarketResearchQuery } from "../provider";

function query(overrides: Partial<MarketResearchQuery> = {}): MarketResearchQuery {
  return {
    brand: "Zara",
    color: "Green",
    category: "Hoodie",
    size: null,
    condition: null,
    notableDetails: "Tiger graphic on front",
    ...overrides,
  };
}

function weakComp(overrides: Partial<QualityFields> = {}): QualityFields {
  return {
    source: "WEB_SEARCH",
    priceCents: 1500,
    matchConfidence: 0.1,
    priceEvidence: "STRUCTURED_DATA",
    visualSimilarity: null,
    ...overrides,
  };
}

function goodResult(overrides: Partial<ComparableSearchResult> = {}): ComparableSearchResult {
  return {
    title: "Zara Green Sweatshirt",
    marketplace: "vinted.com",
    priceCents: 2000,
    priceType: "ASKING",
    url: "https://vinted.com/items/1",
    condition: "Good",
    recency: null,
    matchConfidence: 0.9,
    priceEvidence: "STRUCTURED_DATA",
    priceEvidenceDetail: null,
    availabilitySignal: null,
    imageUrl: null,
    visualSimilarity: null,
    ...overrides,
  };
}

/** Loosened on purpose: buildRefinementTools returns tools with different
 * Zod input types, and TS unifies a heterogeneous array's element type in a
 * way that would otherwise force every call site to satisfy all four tools'
 * inputs at once. Callers supply their own input type per tool via T. */
function findTool<T>(tools: ReturnType<typeof buildRefinementTools>, name: string): { run: (input: T) => Promise<unknown> } {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool as unknown as { run: (input: T) => Promise<unknown> };
}

function toQualityFields(results: ComparableSearchResult[]): QualityFields[] {
  return results.map((r) => ({
    source: "WEB_SEARCH",
    priceCents: r.priceCents,
    matchConfidence: r.matchConfidence,
    priceEvidence: r.priceEvidence,
    visualSimilarity: r.visualSimilarity,
  }));
}

function makeDeps(overrides: Partial<RefinementAgentDeps> = {}): RefinementAgentDeps {
  return {
    originalQuery: query(),
    itemPhotos: [],
    baselineComps: [weakComp()],
    runResearch: async () => [goodResult()],
    persistIteration: async (_q, newResults) => toQualityFields(newResults),
    ...overrides,
  };
}

test("retry_with_category_variant calls runResearch with the overridden category and unchanged other fields", async () => {
  let receivedQuery: MarketResearchQuery | null = null;
  const deps = makeDeps({
    runResearch: async (q) => {
      receivedQuery = q;
      return [goodResult()];
    },
  });
  const tools = buildRefinementTools(deps, { remaining: MAX_REFINEMENT_RETRIES }, { cumulativeComps: deps.baselineComps, outcome: null });
  const tool = findTool(tools, "retry_with_category_variant");

  await tool.run({ category: "Sweatshirt", reasoning: "broader term" });

  assert.equal(receivedQuery!.category, "Sweatshirt");
  assert.equal(receivedQuery!.brand, "Zara");
  assert.equal(receivedQuery!.color, "Green");
});

test("retry_with_brand_variant overrides only brand", async () => {
  let receivedQuery: MarketResearchQuery | null = null;
  const deps = makeDeps({
    runResearch: async (q) => {
      receivedQuery = q;
      return [];
    },
  });
  const tools = buildRefinementTools(deps, { remaining: MAX_REFINEMENT_RETRIES }, { cumulativeComps: deps.baselineComps, outcome: null });
  await findTool(tools, "retry_with_brand_variant").run({ brand: "Polo Ralph Lauren", reasoning: "sub-brand" });

  assert.equal(receivedQuery!.brand, "Polo Ralph Lauren");
  assert.equal(receivedQuery!.category, "Hoodie");
});

test("retry_without_notable_detail clears notableDetails only", async () => {
  let receivedQuery: MarketResearchQuery | null = null;
  const deps = makeDeps({
    runResearch: async (q) => {
      receivedQuery = q;
      return [];
    },
  });
  const tools = buildRefinementTools(deps, { remaining: MAX_REFINEMENT_RETRIES }, { cumulativeComps: deps.baselineComps, outcome: null });
  await findTool(tools, "retry_without_notable_detail").run({ reasoning: "detail may be too narrow" });

  assert.equal(receivedQuery!.notableDetails, null);
  assert.equal(receivedQuery!.brand, "Zara");
});

test("a retry decrements the budget and calls persistIteration with the raw research results", async () => {
  let persistedResults: ComparableSearchResult[] | null = null;
  const deps = makeDeps({
    runResearch: async () => [goodResult(), goodResult({ url: "https://vinted.com/items/2" })],
    persistIteration: async (_q, newResults) => {
      persistedResults = newResults;
      return [...deps.baselineComps, ...toQualityFields(newResults)];
    },
  });
  const budget = { remaining: MAX_REFINEMENT_RETRIES };
  const state = { cumulativeComps: deps.baselineComps, outcome: null };
  const tools = buildRefinementTools(deps, budget, state);

  const resultRaw = await findTool(tools, "retry_with_category_variant").run({ category: "Sweatshirt", reasoning: "x" });
  const result = JSON.parse(resultRaw as string);

  assert.equal(persistedResults!.length, 2);
  assert.equal(budget.remaining, MAX_REFINEMENT_RETRIES - 1);
  assert.equal(result.retriesRemaining, MAX_REFINEMENT_RETRIES - 1);
  assert.equal(result.newCandidatesFound, 2);
});

test("budget exhaustion returns an error without calling runResearch, and never decrements below zero", async () => {
  let runResearchCalled = false;
  const deps = makeDeps({
    runResearch: async () => {
      runResearchCalled = true;
      return [];
    },
  });
  const budget = { remaining: 0 };
  const tools = buildRefinementTools(deps, budget, { cumulativeComps: deps.baselineComps, outcome: null });

  const resultRaw = await findTool(tools, "retry_with_category_variant").run({ category: "Sweatshirt", reasoning: "x" });
  const result = JSON.parse(resultRaw as string);

  assert.equal(runResearchCalled, false);
  assert.match(result.error, /No retries remaining/);
  assert.equal(budget.remaining, 0);
});

test("tier recomputation reflects the updated cumulative comp set after a retry", async () => {
  const deps = makeDeps({
    baselineComps: [weakComp(), weakComp()],
    runResearch: async () => [goodResult(), goodResult({ url: "b" }), goodResult({ url: "c" })],
    persistIteration: async (_q, newResults) => [weakComp(), weakComp(), ...newResults.map((r) => ({
      source: "WEB_SEARCH" as const,
      priceCents: r.priceCents,
      matchConfidence: r.matchConfidence,
      priceEvidence: r.priceEvidence,
      visualSimilarity: r.visualSimilarity,
    }))],
  });
  const state = { cumulativeComps: deps.baselineComps, outcome: null };
  const tools = buildRefinementTools(deps, { remaining: MAX_REFINEMENT_RETRIES }, state);

  const resultRaw = await findTool(tools, "retry_with_category_variant").run({ category: "Sweatshirt", reasoning: "x" });
  const result = JSON.parse(resultRaw as string);

  assert.equal(result.sufficientNow, true, "3 GOOD-tier comps should clear the sufficiency bar");
  assert.equal(result.tierCounts.GOOD, 3);
  assert.equal(state.cumulativeComps.length, 5);
});

test("report_final_outcome captures the decision and summary into session state", async () => {
  const deps = makeDeps();
  const state = { cumulativeComps: deps.baselineComps, outcome: null as import("./refine-comparables-agent").RefinementOutcome | null };
  const tools = buildRefinementTools(deps, { remaining: MAX_REFINEMENT_RETRIES }, state);

  await findTool(tools, "report_final_outcome").run({ decision: "insufficient", summary: "Tried a broader category, still not enough." });

  assert.equal(state.outcome!.decision, "insufficient");
  assert.equal(state.outcome!.summary, "Tried a broader category, still not enough.");
});
