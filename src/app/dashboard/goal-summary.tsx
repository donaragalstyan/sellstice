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
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-gradient text-2xl font-semibold sm:text-3xl">
          {formatCents(progress.revenueEarnedCents)}
        </span>
        <span className="text-sm" style={{ color: "var(--color-muted)" }}>
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

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Remaining</dt>
          <dd className="font-medium">{formatCents(progress.revenueRemainingCents)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Monthly target</dt>
          <dd className="font-medium">{formatCents(progress.monthlyTargetRemainingCents)}/mo</dd>
        </div>
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Weekly target</dt>
          <dd className="font-medium">{formatCents(progress.weeklyTargetRemainingCents)}/wk</dd>
        </div>
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Days remaining</dt>
          <dd className="font-medium">{progress.daysRemaining}</dd>
        </div>

        {progress.estimatedAdditionalSalesNeeded !== null && (
          <div>
            <dt style={{ color: "var(--color-muted)" }}>Est. sales needed</dt>
            <dd className="font-medium">{progress.estimatedAdditionalSalesNeeded}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
