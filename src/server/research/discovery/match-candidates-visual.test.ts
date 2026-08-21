import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchCandidatesVisual,
  type VisualMatchCandidateInput,
  type VisualMatchJudgment,
} from "./match-candidates-visual";
import { MarketResearchProviderError } from "../provider";
import type { ImageInput } from "@/server/ai";

function itemPhotos(): ImageInput[] {
  return [{ base64: "item-photo-bytes", mediaType: "image/jpeg" }];
}

function input(overrides: Partial<VisualMatchCandidateInput> = {}): VisualMatchCandidateInput {
  return {
    index: 0,
    title: "Zara Green Hoodie",
    marketplace: "vinted.com",
    image: { base64: "candidate-photo-bytes", mediaType: "image/jpeg" },
    ...overrides,
  };
}

function judgment(overrides: Partial<VisualMatchJudgment> = {}): VisualMatchJudgment {
  return { index: 0, visualSimilarity: 0.8, rationale: null, ...overrides };
}

test("returns judgments matched by index", async () => {
  const parse = async () => ({
    stop_reason: "end_turn",
    parsed_output: { judgments: [judgment({ index: 5 })] },
  });
  const result = await matchCandidatesVisual(itemPhotos(), [input({ index: 5 })], { parse });
  assert.equal(result.length, 1);
  assert.equal(result[0].index, 5);
  assert.equal(result[0].visualSimilarity, 0.8);
});

test("throws when the judgments array length doesn't match the candidate count", async () => {
  const parse = async () => ({ stop_reason: "end_turn", parsed_output: { judgments: [] } });
  await assert.rejects(
    () => matchCandidatesVisual(itemPhotos(), [input(), input({ index: 1 })], { parse }),
    MarketResearchProviderError,
  );
});

test("throws on a refusal stop reason", async () => {
  const parse = async () => ({ stop_reason: "refusal", parsed_output: null });
  await assert.rejects(
    () => matchCandidatesVisual(itemPhotos(), [input()], { parse }),
    MarketResearchProviderError,
  );
});

test("throws when parsed_output is null", async () => {
  const parse = async () => ({ stop_reason: "end_turn", parsed_output: null });
  await assert.rejects(
    () => matchCandidatesVisual(itemPhotos(), [input()], { parse }),
    MarketResearchProviderError,
  );
});

test("wraps an underlying call failure into MarketResearchProviderError", async () => {
  const parse = async () => {
    throw new Error("network down");
  };
  await assert.rejects(
    () => matchCandidatesVisual(itemPhotos(), [input()], { parse }),
    MarketResearchProviderError,
  );
});

test("skips the call entirely for an empty candidate list", async () => {
  let called = false;
  const parse = async () => {
    called = true;
    return { stop_reason: "end_turn", parsed_output: { judgments: [] } };
  };
  const result = await matchCandidatesVisual(itemPhotos(), [], { parse });
  assert.deepEqual(result, []);
  assert.equal(called, false);
});
