"use client";

import { useState, useTransition } from "react";
import { analyzeItemAction } from "./ai-actions";

// analyzeItemAction (a billed AI call) must only ever run from this onClick
// handler — never from a useEffect, page load, or re-render. If you're
// tempted to add an effect here to "auto-analyze new items," don't; that's
// exactly the accidental-repeated-API-call failure mode this button exists
// to prevent. The server action also enforces a per-item cooldown as a
// backstop against double-clicks and races.
export function AnalyzeButton({ itemId, disabled }: { itemId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await analyzeItemAction(itemId);
            setError(result.error);
          })
        }
        className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Analyzing…" : "Analyze photos with AI"}
      </button>
      {disabled && (
        <p className="text-xs text-gray-500">Add a photo first to enable analysis.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
