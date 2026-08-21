import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichComparables } from "./enrich-comparables";
import type { ComparableCandidate } from "../provider";

// ComparableCandidate deliberately has no priceCents field at all (see
// provider.ts) — enrichComparables is the only source of a final priceCents.
function candidate(overrides: Partial<ComparableCandidate> = {}): ComparableCandidate {
  return {
    title: "Zara Cream Sweater Size M",
    marketplace: "Poshmark",
    priceType: "ASKING",
    url: "https://poshmark.com/listing/abc123",
    condition: "Good",
    recency: "listed 3 days ago",
    matchConfidence: 0.8,
    imageUrl: null,
    ...overrides,
  };
}

test("a candidate with no URL short-circuits to UNVERIFIED without fetching", async () => {
  let fetchCalls = 0;
  const [result] = await enrichComparables([candidate({ url: null })], {
    fetchHtml: async () => {
      fetchCalls += 1;
      return { status: "ok", html: "", finalUrl: "" };
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "UNVERIFIED");
});

test("a successfully fetched and extracted price becomes the result's priceCents", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "ok", html: "<html></html>", finalUrl: "x" }),
    extract: () => ({ evidence: "STRUCTURED_DATA", priceCents: 4199, currency: "USD" }),
  });
  assert.equal(result.priceCents, 4199);
  assert.equal(result.priceEvidence, "STRUCTURED_DATA");
});

test("a blocked fetch yields BLOCKED evidence and a null price", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "blocked", reason: "HTTP 403" }),
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "BLOCKED");
});

test("a fetch error yields UNVERIFIED, not BLOCKED", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "error", reason: "timed out" }),
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "UNVERIFIED");
});

test("a successful fetch with no verifiable price yields UNVERIFIED", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "ok", html: "<html></html>", finalUrl: "x" }),
    extract: () => ({ evidence: "UNVERIFIED", priceCents: null, reason: "nothing found" }),
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "UNVERIFIED");
});

test("an unexpected throw from fetchHtml is absorbed as UNVERIFIED and does not sink the batch", async () => {
  const results = await enrichComparables(
    [candidate({ title: "A", url: "https://a.example/1" }), candidate({ title: "B", url: "https://b.example/1" })],
    {
      fetchHtml: async (url) => {
        if (url.includes("a.example")) throw new Error("boom");
        return { status: "ok", html: "", finalUrl: url };
      },
      extract: () => ({ evidence: "STRUCTURED_DATA", priceCents: 1000, currency: "USD" }),
    },
  );
  assert.equal(results[0].priceEvidence, "UNVERIFIED");
  assert.equal(results[0].priceCents, null);
  assert.equal(results[1].priceEvidence, "STRUCTURED_DATA");
  assert.equal(results[1].priceCents, 1000);
});

test("preserves input order regardless of which candidate resolves first", async () => {
  const candidates = [
    candidate({ title: "Slow", url: "https://slow.example/1" }),
    candidate({ title: "Fast", url: "https://fast.example/1" }),
  ];
  const results = await enrichComparables(candidates, {
    fetchHtml: async (url) => {
      const delayMs = url.includes("slow") ? 30 : 0;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: "ok", html: url, finalUrl: url };
    },
    extract: (html) => ({
      evidence: "STRUCTURED_DATA",
      priceCents: html.includes("slow") ? 1111 : 2222,
      currency: "USD",
    }),
  });
  assert.equal(results[0].title, "Slow");
  assert.equal(results[0].priceCents, 1111);
  assert.equal(results[1].title, "Fast");
  assert.equal(results[1].priceCents, 2222);
});

test("respects the configured concurrency limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const candidates = Array.from({ length: 8 }, (_, i) =>
    candidate({ title: `Item ${i}`, url: `https://example.com/${i}` }),
  );
  await enrichComparables(candidates, {
    concurrency: 3,
    fetchHtml: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { status: "ok", html: "", finalUrl: "" };
    },
    extract: () => ({ evidence: "UNVERIFIED", priceCents: null, reason: "n/a" }),
  });
  assert.ok(maxInFlight <= 3, `expected max 3 concurrent, got ${maxInFlight}`);
  assert.equal(maxInFlight, 3, "expected concurrency to actually reach the configured limit");
});

test("empty candidate list resolves to an empty array", async () => {
  const results = await enrichComparables([]);
  assert.deepEqual(results, []);
});
