"use client";

import { useTransition } from "react";
import { applySuggestionAction, type AppliableField } from "./ai-actions";

export function ApplySuggestionButton({
  itemId,
  analysisId,
  field,
  applied,
}: {
  itemId: string;
  analysisId: string;
  field: AppliableField;
  applied: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (applied) {
    return <span className="text-xs text-green-700 dark:text-green-400">Applied ✓</span>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => applySuggestionAction(itemId, analysisId, field))}
      className="text-xs text-blue-600 underline hover:text-blue-700 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {pending ? "Applying…" : "Apply"}
    </button>
  );
}
