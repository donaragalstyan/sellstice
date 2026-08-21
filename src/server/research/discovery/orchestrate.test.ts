import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverCandidates } from "./orchestrate";
import type { DiscoveredCandidate, MarketplaceDiscoveryProvider } from "./types";
import type { MarketResearchQuery } from "../provider";

function query(): MarketResearchQuery {
  return { brand: "Zara", color: null, category: "Hoodie", size: null, condition: null, notableDetails: null };
}

function candidate(marketplace: string): DiscoveredCandidate {
  return { marketplace, title: "t", url: `https://${marketplace}/x`, snippet: null, sourceRank: 1 };
}

function stubProvider(
  marketplace: string,
  outcome: { results: DiscoveredCandidate[] } | { error: Error },
  bestEffort = false,
): MarketplaceDiscoveryProvider {
  return {
    marketplace,
    bestEffort,
    discover: async () => {
      if ("error" in outcome) throw outcome.error;
      return outcome.results;
    },
  };
}

test("combines results from multiple succeeding providers", async () => {
  const a = stubProvider("a.com", { results: [candidate("a.com")] });
  const b = stubProvider("b.com", { results: [candidate("b.com")] });
  const result = await discoverCandidates(query(), { providers: [a, b] });
  const marketplaces = result.map((r) => r.marketplace).sort();
  assert.deepEqual(marketplaces, ["a.com", "b.com"]);
});

test("one non-best-effort provider failing does not sink the others", async () => {
  const failing = stubProvider("a.com", { error: new Error("boom") }, false);
  const ok = stubProvider("b.com", { results: [candidate("b.com")] });
  const result = await discoverCandidates(query(), { providers: [failing, ok] });
  assert.deepEqual(
    result.map((r) => r.marketplace),
    ["b.com"],
  );
});

test("a best-effort provider failing does not log at the same level as a non-best-effort failure", async () => {
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const bestEffortFailing = stubProvider("mercari.com", { error: new Error("boom") }, true);
    const ok = stubProvider("b.com", { results: [candidate("b.com")] });
    const result = await discoverCandidates(query(), { providers: [bestEffortFailing, ok] });
    assert.deepEqual(
      result.map((r) => r.marketplace),
      ["b.com"],
    );
    assert.equal(errors.length, 0);
  } finally {
    console.error = originalError;
  }
});

test("a non-best-effort provider failing does get logged", async () => {
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const failing = stubProvider("a.com", { error: new Error("boom") }, false);
    await discoverCandidates(query(), { providers: [failing] });
    assert.equal(errors.length, 1);
  } finally {
    console.error = originalError;
  }
});

test("all providers failing resolves to [] rather than throwing", async () => {
  const a = stubProvider("a.com", { error: new Error("boom") }, false);
  const b = stubProvider("b.com", { error: new Error("boom") }, true);
  const result = await discoverCandidates(query(), { providers: [a, b] });
  assert.deepEqual(result, []);
});

test("an empty provider list resolves to [] immediately", async () => {
  const result = await discoverCandidates(query(), { providers: [] });
  assert.deepEqual(result, []);
});
