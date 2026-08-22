"use client";

import { useState, useTransition } from "react";
import { assessSellTimingAction } from "./sell-timing-actions";

// assessSellTimingAction (a billed AI call) must only ever run from this
// onClick handler — never from a useEffect, page load, or re-render. Same
// rationale as AnalyzeButton. The server action also enforces a per-item
// cooldown as a backstop against double-clicks and races.
export function SellTimingButton({ itemId, disabled }: { itemId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await assessSellTimingAction(itemId);
            setError(result.error);
          })
        }
        className="btn btn-secondary self-start"
      >
        {pending ? "Thinking…" : "Get sell-timing recommendation"}
      </button>
      {disabled && (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Add a brand or category first.</p>
      )}
      {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}
