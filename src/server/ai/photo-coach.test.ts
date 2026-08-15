import { test } from "node:test";
import assert from "node:assert/strict";
import {
  photoCoachSchema,
  determineBestCoverIndex,
  validatePhotoCoachPhotoNumbers,
  mapPhotoCoachToCreateData,
  getPhotoCoachCooldownRemainingMs,
  PHOTO_COACH_COOLDOWN_MS,
  DEFAULT_MODEL,
} from "./photo-coach";

const okField = { ok: true, feedback: null };
const badField = (feedback: string) => ({ ok: false, feedback });

const validPayload = {
  photos: [
    {
      photoNumber: 1,
      score: 8.7,
      isBestCover: true,
      lighting: okField,
      framing: okField,
      background: okField,
      shapeVisible: okField,
    },
    {
      photoNumber: 2,
      score: 5.2,
      isBestCover: false,
      lighting: badField("is too dark"),
      framing: badField("crops the hem"),
      background: okField,
      shapeVisible: okField,
    },
  ],
  missingShots: ["BRAND_TAG", "MODELED_PHOTO"],
};

test("accepts a fully-populated valid payload", () => {
  assert.equal(photoCoachSchema.safeParse(validPayload).success, true);
});

test("rejects an unknown missing-shot type", () => {
  const invalid = { ...validPayload, missingShots: ["EMBROIDERED_LOGO_CLOSEUP"] };
  assert.equal(photoCoachSchema.safeParse(invalid).success, false);
});

test("rejects a photo entry missing a required feedback category", () => {
  const photoMissingLighting: Partial<typeof validPayload.photos[0]> = { ...validPayload.photos[0] };
  delete photoMissingLighting.lighting;
  const invalid = { ...validPayload, photos: [photoMissingLighting, validPayload.photos[1]] };
  assert.equal(photoCoachSchema.safeParse(invalid).success, false);
});

test("empty missingShots list is valid (photo set already comprehensive)", () => {
  const complete = { ...validPayload, missingShots: [] };
  assert.equal(photoCoachSchema.safeParse(complete).success, true);
});

test("determineBestCoverIndex trusts a single flagged photo", () => {
  const photos = [
    { score: 6, isBestCover: false },
    { score: 9, isBestCover: true },
    { score: 7, isBestCover: false },
  ];
  assert.equal(determineBestCoverIndex(photos), 1);
});

test("determineBestCoverIndex falls back to highest score when zero are flagged", () => {
  const photos = [
    { score: 6, isBestCover: false },
    { score: 9, isBestCover: false },
    { score: 7, isBestCover: false },
  ];
  assert.equal(determineBestCoverIndex(photos), 1);
});

test("determineBestCoverIndex falls back to highest score when multiple are flagged", () => {
  const photos = [
    { score: 6, isBestCover: true },
    { score: 9, isBestCover: true },
    { score: 7, isBestCover: false },
  ];
  assert.equal(determineBestCoverIndex(photos), 1);
});

test("determineBestCoverIndex handles a single photo", () => {
  assert.equal(determineBestCoverIndex([{ score: 4, isBestCover: false }]), 0);
});

test("validatePhotoCoachPhotoNumbers accepts an exact 1..N permutation", () => {
  assert.equal(validatePhotoCoachPhotoNumbers([2, 1, 3], 3), true);
});

test("validatePhotoCoachPhotoNumbers rejects a count mismatch", () => {
  assert.equal(validatePhotoCoachPhotoNumbers([1, 2], 3), false);
});

test("validatePhotoCoachPhotoNumbers rejects duplicates even with the right count", () => {
  assert.equal(validatePhotoCoachPhotoNumbers([1, 1, 3], 3), false);
});

test("validatePhotoCoachPhotoNumbers rejects a gap (e.g. 1,2,4 for N=3)", () => {
  assert.equal(validatePhotoCoachPhotoNumbers([1, 2, 4], 3), false);
});

test("mapPhotoCoachToCreateData maps photoNumber back to the correct photo id/order", () => {
  const photos = [
    { id: "photo_a", order: 0 },
    { id: "photo_b", order: 1 },
  ];
  const parsed = photoCoachSchema.parse(validPayload);
  const data = mapPhotoCoachToCreateData("item_1", photos, parsed);

  assert.equal(data.itemId, "item_1");
  assert.equal(data.modelId, `anthropic:${DEFAULT_MODEL}`);
  assert.deepEqual(data.missingShots, ["BRAND_TAG", "MODELED_PHOTO"]);

  const scores = data.scores.create;
  assert.equal(scores.length, 2);
  assert.equal(scores[0].photoId, "photo_a");
  assert.equal(scores[0].photoOrder, 0);
  assert.equal(scores[0].isBestCover, true);
  assert.equal(scores[1].photoId, "photo_b");
  assert.equal(scores[1].isBestCover, false);
  assert.equal(scores[1].lightingFeedback, "is too dark");
  assert.equal(scores[1].framingFeedback, "crops the hem");
});

test("mapPhotoCoachToCreateData reconciles best cover deterministically when the model disagrees with itself", () => {
  const photos = [
    { id: "photo_a", order: 0 },
    { id: "photo_b", order: 1 },
  ];
  const bothFlagged = {
    photos: [
      { ...validPayload.photos[0], isBestCover: true, score: 6 },
      { ...validPayload.photos[1], isBestCover: true, score: 9 },
    ],
    missingShots: [],
  };
  const parsed = photoCoachSchema.parse(bothFlagged);
  const data = mapPhotoCoachToCreateData("item_1", photos, parsed);

  assert.equal(data.scores.create[0].isBestCover, false);
  assert.equal(data.scores.create[1].isBestCover, true);
});

test("no cooldown when the item has never had a photo-coach run", () => {
  assert.equal(getPhotoCoachCooldownRemainingMs(null, new Date()), 0);
});

test("blocks a re-run immediately after a previous one", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const lastRunAt = new Date("2026-01-01T00:00:00.000Z");
  const remaining = getPhotoCoachCooldownRemainingMs(lastRunAt, now);
  assert.equal(remaining, PHOTO_COACH_COOLDOWN_MS - 10_000);
  assert.ok(remaining > 0);
});
