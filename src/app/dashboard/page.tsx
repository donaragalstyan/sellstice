import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateGoalProgress } from "@/server/services/goal.service";
import { GoalForm } from "./goal-form";
import { GoalSummary } from "./goal-summary";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [goal, itemCount] = await Promise.all([
    prisma.goal.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.item.count({ where: { userId } }),
  ]);

  // No sales are tracked yet (that lands in a later phase), so earned
  // revenue is always zero for now — the pace math is still real, it just
  // has nothing to show progress against yet.
  const progress = goal
    ? calculateGoalProgress({
        targetAmountCents: goal.targetAmountCents,
        revenueEarnedCents: 0,
        startDate: goal.startDate,
        deadline: goal.deadline,
      })
    : null;

  return (
    <main className="animate-in page max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="eyebrow">Your plan</span>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="btn btn-secondary self-start">
            Sign out
          </button>
        </form>
      </div>
      <p style={{ color: "var(--color-muted)" }}>
        Signed in as <span className="font-medium" style={{ color: "var(--color-ink)" }}>{session?.user?.email}</span>.
      </p>

      {goal && progress ? (
        <div className="flex flex-col gap-6">
          <GoalSummary progress={progress} />
          <details className="text-sm">
            <summary className="cursor-pointer" style={{ color: "var(--color-muted)" }}>
              Edit goal
            </summary>
            <div className="mt-3">
              <GoalForm
                goalId={goal.id}
                defaultTargetAmount={goal.targetAmountCents / 100}
                defaultDeadline={goal.deadline.toISOString().slice(0, 10)}
              />
            </div>
          </details>
        </div>
      ) : (
        <div className="card">
          <h2 className="text-sm font-medium">Set your resale goal</h2>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            How much do you want to make, and by when? We&apos;ll turn that into a
            pace you can track.
          </p>
          <GoalForm />
        </div>
      )}

      <Link href="/items" className="card card-row interactive">
        <div>
          <h2 className="text-sm font-medium">Inventory</h2>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {itemCount === 0
              ? "No items yet — add the first thing you're thinking of selling."
              : `${itemCount} item${itemCount === 1 ? "" : "s"} in inventory.`}
          </p>
        </div>
        <span className="link shrink-0 text-sm">Manage →</span>
      </Link>

      <div className="card card-dashed text-sm" style={{ color: "var(--color-muted)" }}>
        Listings will show up here in a later phase.
      </div>
    </main>
  );
}
