import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemAnalysisSchema,
  selectPhotosForAnalysis,
  mapAnalysisToCreateData,
  getAnalysisCooldownRemainingMs,
  MAX_ANALYSIS_PHOTOS,
  ANALYSIS_COOLDOWN_MS,
  DEFAULT_MODEL,
} from "./item-analysis";

const validPayload = {
  brand: { value: "Zara", confidence: 0.82 },
  color: { value: "Cream", confidence: 0.9 },
  itemType: { value: "Crewneck sweater", confidence: 0.7 },
  category: { value: "Sweater", confidence: 0.75 },
  condition: { value: "LIKE_NEW", confidence: 0.6 },
  styleKeywords: ["chunky knit", "cottagecore"],
  visibleDetails: ["ribbed cuffs"],
  missingPhotoSuggestions: ["A close-up of the care label"],
};

test("accepts a fully-populated valid payload", () => {
  const result = itemAnalysisSchema.safeParse(validPayload);
  assert.equal(result.success, true);
});

test("unknown/null is a valid outcome for every suggested field", () => {
  const allUnknown = {
    brand: { value: null, confidence: null },
    color: { value: null, confidence: null },
    itemType: { value: null, confidence: null },
    category: { value: null, confidence: null },
    condition: { value: null, confidence: null },
    styleKeywords: [],
    visibleDetails: [],
    missingPhotoSuggestions: [],
  };
  const result = itemAnalysisSchema.safeParse(allUnknown);
  assert.equal(result.success, true);
});

test("rejects a condition value outside the known enum", () => {
  const invalid = {
    ...validPayload,
    condition: { value: "BRAND_NEW_IN_BOX", confidence: 0.5 },
  };
  const result = itemAnalysisSchema.safeParse(invalid);
  assert.equal(result.success, false);
});

test("rejects a missing required array field", () => {
  const missingField: Partial<typeof validPayload> = { ...validPayload };
  delete missingField.styleKeywords;
  const result = itemAnalysisSchema.safeParse(missingField);
  assert.equal(result.success, false);
});

test("selectPhotosForAnalysis caps at the max without mutating input order", () => {
  const photos = [1, 2, 3, 4, 5, 6];
  const selected = selectPhotosForAnalysis(photos);
  assert.deepEqual(selected, [1, 2, 3, 4]);
  assert.equal(selected.length, MAX_ANALYSIS_PHOTOS);
});

test("selectPhotosForAnalysis passes through fewer photos than the max unchanged", () => {
  const photos = ["a", "b"];
  assert.deepEqual(selectPhotosForAnalysis(photos), ["a", "b"]);
});

test("mapAnalysisToCreateData flattens nested suggestion fields for storage", () => {
  const parsed = itemAnalysisSchema.parse(validPayload);
  const data = mapAnalysisToCreateData("item_123", parsed);

  assert.equal(data.itemId, "item_123");
  assert.equal(data.brandValue, "Zara");
  assert.equal(data.brandConfidence, 0.82);
  assert.equal(data.conditionValue, "LIKE_NEW");
  assert.deepEqual(data.styleKeywords, ["chunky knit", "cottagecore"]);
  assert.equal(data.modelId, `anthropic:${DEFAULT_MODEL}`);
});

test("mapAnalysisToCreateData carries nulls through untouched", () => {
  const parsed = itemAnalysisSchema.parse({
    brand: { value: null, confidence: null },
    color: { value: null, confidence: null },
    itemType: { value: null, confidence: null },
    category: { value: null, confidence: null },
    condition: { value: null, confidence: null },
    styleKeywords: [],
    visibleDetails: [],
    missingPhotoSuggestions: [],
  });
  const data = mapAnalysisToCreateData("item_456", parsed);
  assert.equal(data.brandValue, null);
  assert.equal(data.conditionValue, null);
});

test("no cooldown when the item has never been analyzed", () => {
  const remaining = getAnalysisCooldownRemainingMs(null, new Date());
  assert.equal(remaining, 0);
});

test("blocks re-analysis immediately after a previous run", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const lastAnalyzedAt = new Date("2026-01-01T00:00:00.000Z");
  const remaining = getAnalysisCooldownRemainingMs(lastAnalyzedAt, now);
  assert.equal(remaining, ANALYSIS_COOLDOWN_MS - 10_000);
  assert.ok(remaining > 0);
});

test("cooldown clears exactly at the boundary and beyond", () => {
  const lastAnalyzedAt = new Date("2026-01-01T00:00:00.000Z");
  const atBoundary = new Date(lastAnalyzedAt.getTime() + ANALYSIS_COOLDOWN_MS);
  const pastBoundary = new Date(lastAnalyzedAt.getTime() + ANALYSIS_COOLDOWN_MS + 1);

  assert.equal(getAnalysisCooldownRemainingMs(lastAnalyzedAt, atBoundary), 0);
  assert.equal(getAnalysisCooldownRemainingMs(lastAnalyzedAt, pastBoundary), 0);
});

test("cooldown never goes negative for a stale last-analyzed timestamp", () => {
  const lastAnalyzedAt = new Date("2020-01-01T00:00:00.000Z");
  const remaining = getAnalysisCooldownRemainingMs(lastAnalyzedAt, new Date());
  assert.equal(remaining, 0);
});
