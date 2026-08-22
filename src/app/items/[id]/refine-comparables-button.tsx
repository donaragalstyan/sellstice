"use client";

import { useState, useTransition } from "react";
import { refineComparablesAction } from "./market-research-actions";

// Same invariant as MarketResearchButton: this billed AI call must only ever
// run from this onClick handler, never a useEffect, page load, or re-render.
// The server action also enforces its own (longer) per-item cooldown as a
// backstop against double-clicks and races — each click can cost up to 3x a
// normal research run, since the agent may re-run the full pipeline twice.
export function RefineComparablesButton({ itemId }: { itemId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await refineComparablesAction(itemId);
            setError(result.error);
            setSummary(result.outcome?.summary ?? null);
          })
        }
        className="btn btn-secondary self-start"
      >
        {pending ? "Refining…" : "Refine further"}
      </button>
      {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
      {summary && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{summary}</p>}
    </div>
  );
}
