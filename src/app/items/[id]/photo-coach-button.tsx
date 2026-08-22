"use client";

import { useState, useTransition } from "react";
import { analyzePhotoCoachAction } from "./photo-coach-actions";

// Same invariant as AnalyzeButton (see that file): this billed AI call must
// only ever run from this onClick handler, never a useEffect, page load, or
// re-render. The server action also enforces a per-item cooldown as a
// backstop against double-clicks and races.
export function PhotoCoachButton({ itemId, disabled }: { itemId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await analyzePhotoCoachAction(itemId);
            setError(result.error);
          })
        }
        className="btn btn-secondary self-start"
      >
        {pending ? "Reviewing photos…" : "Get photo feedback"}
      </button>
      {disabled && <p className="text-xs" style={{ color: "var(--color-muted)" }}>Add a photo first to enable review.</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}
