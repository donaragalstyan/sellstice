import { test } from "node:test";
import assert from "node:assert/strict";
import { getCooldownRemainingMs } from "./cooldown";

test("no cooldown when nothing has run yet", () => {
  assert.equal(getCooldownRemainingMs(null, new Date(), 30_000), 0);
});

test("reports remaining time partway through the cooldown window", () => {
  const lastRunAt = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-01-01T00:00:10.000Z");
  assert.equal(getCooldownRemainingMs(lastRunAt, now, 30_000), 20_000);
});

test("clears exactly at the boundary and beyond", () => {
  const lastRunAt = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(getCooldownRemainingMs(lastRunAt, new Date(lastRunAt.getTime() + 30_000), 30_000), 0);
  assert.equal(getCooldownRemainingMs(lastRunAt, new Date(lastRunAt.getTime() + 30_001), 30_000), 0);
});

test("never goes negative for a stale timestamp", () => {
  const lastRunAt = new Date("2020-01-01T00:00:00.000Z");
  assert.equal(getCooldownRemainingMs(lastRunAt, new Date(), 30_000), 0);
});
