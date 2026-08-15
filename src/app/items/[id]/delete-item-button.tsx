"use client";

import { useState, useTransition } from "react";
import { deleteItemAction } from "../actions";

export function DeleteItemButton({ itemId }: { itemId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
      >
        Delete item
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-600">Delete this item and its photos?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => deleteItemAction(itemId))}
        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Confirm delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  );
}
