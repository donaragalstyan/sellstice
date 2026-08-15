import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateImageFile,
  assertPhotoCountWithinLimit,
  MAX_IMAGE_BYTES,
  MAX_PHOTOS_PER_ITEM,
} from "./image-validation";

test("accepts a normal JPEG", () => {
  const result = validateImageFile({ type: "image/jpeg", size: 1024 });
  assert.equal(result.ok, true);
});

test("rejects a non-image type", () => {
  const result = validateImageFile({ type: "application/pdf", size: 1024 });
  assert.equal(result.ok, false);
});

test("rejects an empty file", () => {
  const result = validateImageFile({ type: "image/png", size: 0 });
  assert.equal(result.ok, false);
});

test("rejects a file over the size limit", () => {
  const result = validateImageFile({ type: "image/webp", size: MAX_IMAGE_BYTES + 1 });
  assert.equal(result.ok, false);
});

test("accepts a file exactly at the size limit", () => {
  const result = validateImageFile({ type: "image/webp", size: MAX_IMAGE_BYTES });
  assert.equal(result.ok, true);
});

test("photo count limit allows filling up to the max", () => {
  const result = assertPhotoCountWithinLimit(MAX_PHOTOS_PER_ITEM - 2, 2);
  assert.equal(result.ok, true);
});

test("photo count limit rejects going over the max", () => {
  const result = assertPhotoCountWithinLimit(MAX_PHOTOS_PER_ITEM - 1, 2);
  assert.equal(result.ok, false);
});
