import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateGoalProgress } from "./goal.service";

const day = (n: number) => new Date(2026, 0, 1 + n);

test("halfway through the timeline, earning exactly the linear pace is ON_TRACK", () => {
  const result = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 50_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });

  assert.equal(result.paceStatus, "ON_TRACK");
  assert.equal(result.percentComplete, 50);
  assert.equal(result.revenueRemainingCents, 50_000);
});

test("earning well above the linear pace is AHEAD", () => {
  const result = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 80_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });

  assert.equal(result.paceStatus, "AHEAD");
  assert.ok(result.paceDeltaCents > 0);
});

test("earning well below the linear pace is BEHIND", () => {
  const result = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 10_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });

  assert.equal(result.paceStatus, "BEHIND");
  assert.ok(result.paceDeltaCents < 0);
});

test("goal met caps revenueRemaining at zero even when overachieved", () => {
  const result = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 120_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });

  assert.equal(result.revenueRemainingCents, 0);
  assert.equal(result.monthlyTargetRemainingCents, 0);
  assert.equal(result.weeklyTargetRemainingCents, 0);
  assert.equal(result.percentComplete, 120);
});

test("deadline already passed clamps daysRemaining to zero and pulls all remaining revenue into monthly/weekly targets", () => {
  const result = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 40_000,
    startDate: day(0),
    deadline: day(30),
    now: day(45),
  });

  assert.equal(result.daysRemaining, 0);
  assert.equal(result.monthlyTargetRemainingCents, 60_000);
  assert.equal(result.weeklyTargetRemainingCents, 60_000);
  assert.equal(result.paceStatus, "BEHIND");
});

test("estimatedAdditionalSalesNeeded is null without an average sale price and rounds up when provided", () => {
  const withoutAverage = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 40_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });
  assert.equal(withoutAverage.estimatedAdditionalSalesNeeded, null);

  const withAverage = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 40_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
    averageSaleCents: 2_500,
  });
  // 60_000 remaining / 2_500 per sale = 24 exactly
  assert.equal(withAverage.estimatedAdditionalSalesNeeded, 24);

  const withRemainder = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 41_000,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
    averageSaleCents: 2_500,
  });
  // 59_000 / 2_500 = 23.6 -> rounds up to 24
  assert.equal(withRemainder.estimatedAdditionalSalesNeeded, 24);
});

test("very short deadline (a few hours left) does not divide by zero", () => {
  const start = new Date(2026, 0, 1);
  const deadline = new Date(2026, 0, 1, 4);
  const now = new Date(2026, 0, 1, 2);

  const result = calculateGoalProgress({
    targetAmountCents: 10_000,
    revenueEarnedCents: 0,
    startDate: start,
    deadline,
    now,
  });

  assert.ok(Number.isFinite(result.monthlyTargetRemainingCents));
  assert.ok(Number.isFinite(result.weeklyTargetRemainingCents));
  assert.equal(result.totalDays, 1);
});

test("pace tolerance: right at the 1% band is still ON_TRACK, one cent past it flips the status", () => {
  // target 100_000, tolerance = max(round(100_000 * 0.01), 100) = 1_000 cents
  const atTolerance = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 51_000, // expected 50_000 at day 50 + exactly the tolerance
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });
  assert.equal(atTolerance.paceStatus, "ON_TRACK");

  const justOverTolerance = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 51_001,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });
  assert.equal(justOverTolerance.paceStatus, "AHEAD");

  const justUnderNegativeTolerance = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 48_999,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });
  assert.equal(justUnderNegativeTolerance.paceStatus, "BEHIND");
});

test("pace tolerance floor keeps small goals from being oversensitive to rounding", () => {
  // target 1_000 cents ($10): 1% would be 10 cents, but the floor bumps it to 100 cents ($1)
  const withinFloor = calculateGoalProgress({
    targetAmountCents: 1_000,
    revenueEarnedCents: 600, // expected 500 at day 50 + 100-cent floor
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });
  assert.equal(withinFloor.paceStatus, "ON_TRACK");

  const beyondFloor = calculateGoalProgress({
    targetAmountCents: 1_000,
    revenueEarnedCents: 601,
    startDate: day(0),
    deadline: day(100),
    now: day(50),
  });
  assert.equal(beyondFloor.paceStatus, "AHEAD");
});

test("no time elapsed yet reports zero expected revenue", () => {
  const result = calculateGoalProgress({
    targetAmountCents: 100_000,
    revenueEarnedCents: 0,
    startDate: day(0),
    deadline: day(100),
    now: day(0),
  });

  assert.equal(result.expectedRevenueByNowCents, 0);
  assert.equal(result.paceStatus, "ON_TRACK");
});
