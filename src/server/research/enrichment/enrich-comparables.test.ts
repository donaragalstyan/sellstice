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
  assert.match(result.priceEvidenceDetail ?? "", /no listing URL/);
});

test("a successfully fetched and extracted price becomes the result's priceCents, with no evidence detail to explain", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "ok", html: "<html></html>", finalUrl: "x" }),
    extract: () => ({ evidence: "STRUCTURED_DATA", priceCents: 4199, currency: "USD" }),
  });
  assert.equal(result.priceCents, 4199);
  assert.equal(result.priceEvidence, "STRUCTURED_DATA");
  assert.equal(result.priceEvidenceDetail, null);
});

test("a blocked fetch yields BLOCKED evidence, a null price, and preserves the block reason", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "blocked", reason: "HTTP 403" }),
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "BLOCKED");
  assert.equal(result.priceEvidenceDetail, "HTTP 403");
});

test("a fetch error yields UNVERIFIED, not BLOCKED, and preserves the error reason", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "error", reason: "timed out" }),
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "UNVERIFIED");
  assert.equal(result.priceEvidenceDetail, "timed out");
});

test("a successful fetch with no verifiable price yields UNVERIFIED and preserves extract-price's reason", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => ({ status: "ok", html: "<html></html>", finalUrl: "x" }),
    extract: () => ({ evidence: "UNVERIFIED", priceCents: null, reason: "nothing found" }),
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "UNVERIFIED");
  assert.equal(result.priceEvidenceDetail, "nothing found");
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

// --- Never invent a price (Phase 10.4 audit) ------------------------------
//
// enrichComparables is the sole place a final ComparableSearchResult's
// priceCents is allowed to come from (see this file's own doc comment above)
// — every exit path must either carry a real extracted price with trusted
// evidence, or be null. These pin that invariant down as an executable
// check rather than leaving it as a comment claim.

test("every non-null priceCents is paired with trusted evidence, on a mixed batch of every outcome", async () => {
  const candidates = [
    candidate({ title: "no url", url: null }),
    candidate({ title: "blocked", url: "https://a.example/1" }),
    candidate({ title: "fetch error", url: "https://b.example/1" }),
    candidate({ title: "unverified extraction", url: "https://c.example/1" }),
    candidate({ title: "verified", url: "https://d.example/1" }),
    candidate({ title: "throws", url: "https://e.example/1" }),
  ];
  const TRUSTED = new Set(["STRUCTURED_DATA", "META_TAG", "MICRODATA"]);
  const results = await enrichComparables(candidates, {
    fetchHtml: async (url) => {
      if (url.includes("a.example")) return { status: "blocked", reason: "HTTP 403" };
      if (url.includes("b.example")) return { status: "error", reason: "timed out" };
      if (url.includes("e.example")) throw new Error("boom");
      return { status: "ok", html: url, finalUrl: url };
    },
    extract: (html) =>
      html.includes("d.example")
        ? { evidence: "STRUCTURED_DATA", priceCents: 3000, currency: "USD" }
        : { evidence: "UNVERIFIED", priceCents: null, reason: "no price found" },
  });

  for (const result of results) {
    if (result.priceCents !== null) {
      assert.ok(
        TRUSTED.has(result.priceEvidence),
        `${result.title}: priceCents ${result.priceCents} must not stand without trusted evidence (got ${result.priceEvidence})`,
      );
    }
  }
  // Sanity check the batch actually exercised both outcomes, not just nulls.
  assert.equal(results.filter((r) => r.priceCents !== null).length, 1);
  assert.equal(results.find((r) => r.title === "verified")?.priceCents, 3000);
});

test("an unexpected throw is absorbed as UNVERIFIED with the error message preserved as evidence detail", async () => {
  const [result] = await enrichComparables([candidate()], {
    fetchHtml: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(result.priceCents, null);
  assert.equal(result.priceEvidence, "UNVERIFIED");
  assert.match(result.priceEvidenceDetail ?? "", /boom/);
});
