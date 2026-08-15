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
        className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Researching…" : "Research comparables"}
      </button>
      {disabled && disabledReason && (
        <p className="text-xs text-gray-500">{disabledReason}</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
