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
      <label className="field">
        Target amount (USD)
        <input
          name="targetAmount"
          type="number"
          min="0.01"
          step="0.01"
          required
          defaultValue={defaultTargetAmount}
          placeholder="1000"
          className="input"
        />
      </label>
      <label className="field">
        Deadline
        <input
          name="deadline"
          type="date"
          required
          defaultValue={defaultDeadline}
          className="input"
        />
      </label>
      {state.error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Saving…" : goalId ? "Update goal" : "Set goal"}
      </button>
    </form>
  );
}
