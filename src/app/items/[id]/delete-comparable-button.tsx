"use client";

import { useTransition } from "react";
import { deleteComparableAction } from "./market-research-actions";

export function DeleteComparableButton({
  itemId,
  comparableId,
}: {
  itemId: string;
  comparableId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => deleteComparableAction(itemId, comparableId))}
      className="text-xs text-red-600 underline hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
