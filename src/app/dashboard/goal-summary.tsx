import { formatCents } from "@/lib/format";
import type { GoalProgressResult } from "@/server/services/goal.service";

const PACE_LABEL: Record<GoalProgressResult["paceStatus"], string> = {
  AHEAD: "ahead of pace",
  BEHIND: "behind pace",
  ON_TRACK: "on pace",
};

export function GoalSummary({ progress }: { progress: GoalProgressResult }) {
  const paceAmount = formatCents(Math.abs(progress.paceDeltaCents));

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-300 p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold">
          {formatCents(progress.revenueEarnedCents)}
        </span>
        <span className="text-sm text-gray-600">
          of {formatCents(progress.targetAmountCents)} ({progress.percentComplete}%)
        </span>
      </div>

      <progress
        className="goal-progress"
        value={Math.min(100, Math.max(0, progress.percentComplete))}
        max={100}
      />

      <p className="text-sm">
        {progress.paceStatus === "ON_TRACK" ? (
          <>You&apos;re right on pace.</>
        ) : (
          <>
            You&apos;re{" "}
            <span className="font-medium">
              {paceAmount} {PACE_LABEL[progress.paceStatus]}
            </span>
            .
          </>
        )}
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-600">Remaining</dt>
        <dd className="text-right">{formatCents(progress.revenueRemainingCents)}</dd>

        <dt className="text-gray-600">Monthly target</dt>
        <dd className="text-right">{formatCents(progress.monthlyTargetRemainingCents)}/mo</dd>

        <dt className="text-gray-600">Weekly target</dt>
        <dd className="text-right">{formatCents(progress.weeklyTargetRemainingCents)}/wk</dd>

        <dt className="text-gray-600">Days remaining</dt>
        <dd className="text-right">{progress.daysRemaining}</dd>

        {progress.estimatedAdditionalSalesNeeded !== null && (
          <>
            <dt className="text-gray-600">Est. sales needed</dt>
            <dd className="text-right">{progress.estimatedAdditionalSalesNeeded}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
