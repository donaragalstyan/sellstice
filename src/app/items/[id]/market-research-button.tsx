"use client";

import { useState, useTransition } from "react";
import { researchComparablesAction } from "./market-research-actions";

// Same invariant as AnalyzeButton/PhotoCoachButton: this billed AI call must
// only ever run from this onClick handler, never a useEffect, page load, or
// re-render. The server action also enforces a per-item cooldown as a
// backstop against double-clicks and races.
export function MarketResearchButton({
  itemId,
  disabled,
  disabledReason,
}: {
  itemId: string;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await researchComparablesAction(itemId);
            setError(result.error);
          })
        }
        className="btn btn-secondary self-start"
      >
        {pending ? "Researching…" : "Research comparables"}
      </button>
      {disabled && disabledReason && (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>{disabledReason}</p>
      )}
      {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}
