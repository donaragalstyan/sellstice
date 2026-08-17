import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCandidates, type MatchCandidateInput, type MatchJudgment } from "./match-candidates";
import { MarketResearchProviderError } from "../provider";
import type { MarketResearchQuery } from "../provider";

function query(): MarketResearchQuery {
  return { brand: "Zara", color: "Green", category: "Hoodie", size: null, condition: null };
}

function input(overrides: Partial<MatchCandidateInput> = {}): MatchCandidateInput {
  return { marketplace: "vinted.com", title: "Zara Green Hoodie", snippet: "worn twice", priceCents: 2500, ...overrides };
}

function judgment(overrides: Partial<MatchJudgment> = {}): MatchJudgment {
  return { matchConfidence: 0.8, priceType: "ASKING", condition: "Good", recency: null, ...overrides };
}

test("returns judgments index-aligned with input candidates", async () => {
  const parse = async () => ({
    stop_reason: "end_turn",
    parsed_output: { judgments: [judgment()] },
  });
  const result = await matchCandidates(query(), [input()], { parse });
  assert.equal(result.length, 1);
  assert.equal(result[0].matchConfidence, 0.8);
});

test("throws when the judgments array length doesn't match the candidate count", async () => {
  const parse = async () => ({
    stop_reason: "end_turn",
    parsed_output: { judgments: [] },
  });
  await assert.rejects(
    () => matchCandidates(query(), [input(), input()], { parse }),
    MarketResearchProviderError,
  );
});

test("throws on a refusal stop reason", async () => {
  const parse = async () => ({ stop_reason: "refusal", parsed_output: null });
  await assert.rejects(() => matchCandidates(query(), [input()], { parse }), MarketResearchProviderError);
});

test("throws when parsed_output is null", async () => {
  const parse = async () => ({ stop_reason: "end_turn", parsed_output: null });
  await assert.rejects(() => matchCandidates(query(), [input()], { parse }), MarketResearchProviderError);
});

test("wraps an underlying call failure into MarketResearchProviderError", async () => {
  const parse = async () => {
    throw new Error("network down");
  };
  await assert.rejects(() => matchCandidates(query(), [input()], { parse }), MarketResearchProviderError);
});

test("skips the call entirely for an empty candidate list", async () => {
  let called = false;
  const parse = async () => {
    called = true;
    return { stop_reason: "end_turn", parsed_output: { judgments: [] } };
  };
  const result = await matchCandidates(query(), [], { parse });
  assert.deepEqual(result, []);
  assert.equal(called, false);
});
