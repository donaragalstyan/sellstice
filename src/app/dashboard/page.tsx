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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Sign out
          </button>
        </form>
      </div>
      <p className="text-gray-600">
        Signed in as <span className="font-medium">{session?.user?.email}</span>.
      </p>

      {goal && progress ? (
        <div className="flex flex-col gap-6">
          <GoalSummary progress={progress} />
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-600">Edit goal</summary>
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
        <div className="flex flex-col gap-4 rounded-lg border border-gray-300 p-5">
          <h2 className="text-sm font-medium">Set your resale goal</h2>
          <p className="text-sm text-gray-600">
            How much do you want to make, and by when? We&apos;ll turn that into a
            pace you can track.
          </p>
          <GoalForm />
        </div>
      )}

      <Link
        href="/items"
        className="flex items-center justify-between rounded-lg border border-gray-300 p-5 hover:bg-gray-50 dark:hover:bg-white/5"
      >
        <div>
          <h2 className="text-sm font-medium">Inventory</h2>
          <p className="text-sm text-gray-600">
            {itemCount === 0
              ? "No items yet — add the first thing you're thinking of selling."
              : `${itemCount} item${itemCount === 1 ? "" : "s"} in inventory.`}
          </p>
        </div>
        <span className="text-sm text-blue-600 underline dark:text-blue-400">Manage →</span>
      </Link>

      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
        Listings will show up here in a later phase.
      </div>
    </main>
  );
}
