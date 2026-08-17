import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchQueries, MAX_QUERIES_PER_MARKETPLACE } from "./build-queries";
import type { MarketResearchQuery } from "../provider";

function query(overrides: Partial<MarketResearchQuery> = {}): MarketResearchQuery {
  return { brand: null, color: null, category: null, size: null, condition: null, ...overrides };
}

test("full attribute set produces a bounded query list", () => {
  const result = buildSearchQueries(
    query({ brand: "Zara", color: "Green", category: "Hoodie", size: "M", condition: "GOOD" as never }),
  );
  assert.ok(result.length <= MAX_QUERIES_PER_MARKETPLACE);
  assert.equal(result[0], "Zara Green Hoodie");
  assert.equal(result[1], "Zara Hoodie");
});

test("brand-only input still produces a usable query", () => {
  const result = buildSearchQueries(query({ brand: "Levi's" }));
  assert.deepEqual(result, ["Levi's"]);
});

test("category-only input still produces a usable query", () => {
  const result = buildSearchQueries(query({ category: "Jeans" }));
  assert.deepEqual(result, ["Jeans"]);
});

test("no attributes produces an empty list without throwing", () => {
  assert.deepEqual(buildSearchQueries(query()), []);
});

test("output length never exceeds the fixed cap", () => {
  const result = buildSearchQueries(
    query({ brand: "Nike", color: "White", category: "Sneakers", size: "10", condition: "NEW" as never }),
  );
  assert.ok(result.length <= MAX_QUERIES_PER_MARKETPLACE);
});

test("never returns duplicate queries", () => {
  // No color, so the precise and loose candidates would otherwise collide.
  const result = buildSearchQueries(query({ brand: "Nike", category: "Sneakers" }));
  assert.equal(new Set(result.map((q) => q.toLowerCase())).size, result.length);
  assert.deepEqual(result, ["Nike Sneakers"]);
});

test("whitespace-only attributes are treated as absent", () => {
  const result = buildSearchQueries(query({ brand: "  ", category: "Jeans" }));
  assert.deepEqual(result, ["Jeans"]);
});
