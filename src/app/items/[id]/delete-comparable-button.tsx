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
      className="text-xs underline decoration-dotted disabled:opacity-50"
      style={{ color: "var(--color-danger)" }}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
