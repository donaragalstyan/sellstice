const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AVG_DAYS_PER_MONTH = 30.44;
const DAYS_PER_WEEK = 7;

/**
 * Pace tolerance band, as a fraction of the target amount, before we call
 * progress AHEAD or BEHIND rather than ON_TRACK. Without this, a seller
 * sitting $1 off a linear pace line would flip between "ahead" and "behind"
 * from rounding alone — the band absorbs that noise so the label only
 * changes when the gap is actually meaningful.
 */
const PACE_TOLERANCE_RATE = 0.01;

/**
 * Floor for the tolerance band in cents, so tiny goals (e.g. a $20 target)
 * still get a sane minimum buffer instead of an unusably small one.
 */
const PACE_TOLERANCE_FLOOR_CENTS = 100;

function calculatePaceTolerance(targetAmountCents: number): number {
  return Math.max(Math.round(targetAmountCents * PACE_TOLERANCE_RATE), PACE_TOLERANCE_FLOOR_CENTS);
}

export type PaceStatus = "AHEAD" | "ON_TRACK" | "BEHIND";

export interface GoalProgressInput {
  targetAmountCents: number;
  revenueEarnedCents: number;
  startDate: Date;
  deadline: Date;
  /** Average sale price, used to estimate how many more sales are needed. Omit if no sales exist yet. */
  averageSaleCents?: number;
  /** Injectable for testability; defaults to the current time. */
  now?: Date;
}

export interface GoalProgressResult {
  targetAmountCents: number;
  revenueEarnedCents: number;
  revenueRemainingCents: number;
  percentComplete: number;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  monthlyTargetRemainingCents: number;
  weeklyTargetRemainingCents: number;
  expectedRevenueByNowCents: number;
  paceDeltaCents: number;
  paceStatus: PaceStatus;
  estimatedAdditionalSalesNeeded: number | null;
}

/**
 * Pure, deterministic goal-pace math — no I/O, no AI. Money is handled in
 * integer cents throughout to avoid floating-point drift.
 */
export function calculateGoalProgress(input: GoalProgressInput): GoalProgressResult {
  const now = input.now ?? new Date();
  const { targetAmountCents, revenueEarnedCents } = input;

  const totalDays = Math.max(
    1,
    Math.round((input.deadline.getTime() - input.startDate.getTime()) / MS_PER_DAY),
  );
  const rawDaysElapsed = Math.floor((now.getTime() - input.startDate.getTime()) / MS_PER_DAY);
  const daysElapsed = Math.min(totalDays, Math.max(0, rawDaysElapsed));
  const daysRemaining = Math.max(
    0,
    Math.ceil((input.deadline.getTime() - now.getTime()) / MS_PER_DAY),
  );

  const revenueRemainingCents = Math.max(0, targetAmountCents - revenueEarnedCents);

  const percentComplete =
    targetAmountCents <= 0 ? 0 : Math.round((revenueEarnedCents / targetAmountCents) * 1000) / 10;

  const monthsRemaining = daysRemaining / AVG_DAYS_PER_MONTH;
  const weeksRemaining = daysRemaining / DAYS_PER_WEEK;
  const monthlyTargetRemainingCents =
    daysRemaining <= 0 || monthsRemaining < 1
      ? revenueRemainingCents
      : Math.round(revenueRemainingCents / monthsRemaining);
  const weeklyTargetRemainingCents =
    daysRemaining <= 0 || weeksRemaining < 1
      ? revenueRemainingCents
      : Math.round(revenueRemainingCents / weeksRemaining);

  const expectedRevenueByNowCents = Math.round(
    targetAmountCents * Math.min(1, daysElapsed / totalDays),
  );
  const paceDeltaCents = revenueEarnedCents - expectedRevenueByNowCents;
  const paceTolerance = calculatePaceTolerance(targetAmountCents);
  const paceStatus: PaceStatus =
    paceDeltaCents > paceTolerance ? "AHEAD" : paceDeltaCents < -paceTolerance ? "BEHIND" : "ON_TRACK";

  const estimatedAdditionalSalesNeeded =
    input.averageSaleCents && input.averageSaleCents > 0
      ? Math.ceil(revenueRemainingCents / input.averageSaleCents)
      : null;

  return {
    targetAmountCents,
    revenueEarnedCents,
    revenueRemainingCents,
    percentComplete,
    totalDays,
    daysElapsed,
    daysRemaining,
    monthlyTargetRemainingCents,
    weeklyTargetRemainingCents,
    expectedRevenueByNowCents,
    paceDeltaCents,
    paceStatus,
    estimatedAdditionalSalesNeeded,
  };
}
