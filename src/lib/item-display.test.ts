import { test } from "node:test";
import assert from "node:assert/strict";
import { getItemDisplayLabel } from "./item-display";

test("joins brand, color, category when present", () => {
  assert.equal(
    getItemDisplayLabel({ brand: "Zara", color: "Cream", category: "Sweater" }),
    "Zara Cream Sweater",
  );
});

test("skips missing fields without leaving gaps", () => {
  assert.equal(getItemDisplayLabel({ brand: "Zara", color: null, category: "Sweater" }), "Zara Sweater");
});

test("falls back to a placeholder when nothing is known yet", () => {
  assert.equal(getItemDisplayLabel({ brand: null, color: null, category: null }), "Untitled item");
});
