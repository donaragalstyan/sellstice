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
        className="btn self-start"
        style={{ border: "1px solid var(--color-danger)", color: "var(--color-danger)", background: "transparent" }}
      >
        Delete item
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span style={{ color: "var(--color-muted)" }}>Delete this item and its photos?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => deleteItemAction(itemId))}
        className="btn btn-danger"
      >
        {pending ? "Deleting…" : "Confirm delete"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="btn btn-secondary">
        Cancel
      </button>
    </div>
  );
}
