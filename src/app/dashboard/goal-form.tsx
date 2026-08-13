"use client";

import { useActionState } from "react";
import { saveGoalAction, type GoalFormState } from "./actions";

const initialState: GoalFormState = { error: null };

export function GoalForm({
  goalId,
  defaultTargetAmount,
  defaultDeadline,
}: {
  goalId?: string;
  defaultTargetAmount?: number;
  defaultDeadline?: string;
}) {
  const [state, formAction, pending] = useActionState(saveGoalAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {goalId && <input type="hidden" name="goalId" value={goalId} />}
      <label className="flex flex-col gap-1 text-sm">
        Target amount (USD)
        <input
          name="targetAmount"
          type="number"
          min="0.01"
          step="0.01"
          required
          defaultValue={defaultTargetAmount}
          placeholder="1000"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Deadline
        <input
          name="deadline"
          type="date"
          required
          defaultValue={defaultDeadline}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : goalId ? "Update goal" : "Set goal"}
      </button>
    </form>
  );
}
