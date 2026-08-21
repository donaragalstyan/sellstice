import { test } from "node:test";
import assert from "node:assert/strict";
import { BraveMarketplaceDiscoveryProvider } from "./brave";
import { MAX_QUERIES_PER_MARKETPLACE } from "../build-queries";
import type { MarketResearchQuery } from "../../provider";

function query(overrides: Partial<MarketResearchQuery> = {}): MarketResearchQuery {
  return {
    brand: "Zara",
    color: null,
    category: "Hoodie",
    size: null,
    condition: null,
    notableDetails: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

test("maps a well-formed Brave response to DiscoveredCandidate[], filtering non-listing URLs", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      web: {
        results: [
          { title: "Zara Green Hoodie", url: "https://www.vinted.com/items/123-zara-green-hoodie", description: "desc" },
          { title: "Hoodies | Vinted", url: "https://www.vinted.com/catalog/196-hoodies" },
        ],
      },
    });
  const adapter = new BraveMarketplaceDiscoveryProvider("vinted.com", { fetchImpl });
  const result = await adapter.discover(query());
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://www.vinted.com/items/123-zara-green-hoodie");
  assert.equal(result[0].marketplace, "vinted.com");
  assert.equal(result[0].snippet, "desc");
});

test("an HTTP error status resolves to [] without retrying", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({}, 500);
  };
  const adapter = new BraveMarketplaceDiscoveryProvider("vinted.com", { fetchImpl });
  const result = await adapter.discover(query({ color: null, category: null }));
  assert.deepEqual(result, []);
  assert.equal(calls, 1);
});

test("a transient network error retries exactly once, then resolves to [] on repeated failure", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  const adapter = new BraveMarketplaceDiscoveryProvider("vinted.com", { fetchImpl });
  const result = await adapter.discover(query({ color: null, category: null }));
  assert.deepEqual(result, []);
  assert.equal(calls, 2);
});

test("never issues more requests than the bounded query cap", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ web: { results: [] } });
  };
  const adapter = new BraveMarketplaceDiscoveryProvider("depop.com", { fetchImpl });
  await adapter.discover(query({ color: "Green" }));
  assert.ok(calls <= MAX_QUERIES_PER_MARKETPLACE);
});

test("bestEffort flag does not change adapter-level behavior on zero results", async () => {
  const fetchImpl = async () => jsonResponse({ web: { results: [] } });
  const nonBestEffort = new BraveMarketplaceDiscoveryProvider("poshmark.com", { fetchImpl, bestEffort: false });
  const bestEffort = new BraveMarketplaceDiscoveryProvider("mercari.com", { fetchImpl, bestEffort: true });
  assert.deepEqual(await nonBestEffort.discover(query()), []);
  assert.deepEqual(await bestEffort.discover(query()), []);
});

test("skips results missing a title or url rather than throwing", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      web: {
        results: [{ title: undefined, url: "https://www.vinted.com/items/1-x" }, { title: "No URL" }],
      },
    });
  const adapter = new BraveMarketplaceDiscoveryProvider("vinted.com", { fetchImpl });
  const result = await adapter.discover(query());
  assert.deepEqual(result, []);
});
