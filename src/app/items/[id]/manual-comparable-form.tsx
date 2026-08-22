"use client";

import { useActionState } from "react";
import { addManualComparableAction, type ManualComparableState } from "./market-research-actions";
import { COMPARABLE_PRICE_TYPES } from "@/lib/validation";

const initialState: ManualComparableState = { error: null };

const PRICE_TYPE_LABELS: Record<string, string> = {
  ASKING: "Asking price",
  SOLD: "Sold price",
  UNKNOWN: "Not sure",
};

export function ManualComparableForm({ itemId }: { itemId: string }) {
  const [state, formAction, pending] = useActionState(addManualComparableAction, initialState);

  return (
    <details className="text-sm">
      <summary className="cursor-pointer" style={{ color: "var(--color-muted)" }}>
        Add a comparable manually
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="itemId" value={itemId} />

        <label className="field">
          Title
          <input
            name="title"
            type="text"
            required
            placeholder="Zara Cream Knit Sweater Size M"
            className="input"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="field">
            Marketplace
            <input name="marketplace" type="text" placeholder="Poshmark" className="input" />
          </label>
          <label className="field">
            Price (USD)
            <input name="price" type="number" min="0" step="0.01" className="input" />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="field">
            Price type
            <select name="priceType" defaultValue="UNKNOWN" className="input">
              {COMPARABLE_PRICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PRICE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Condition
            <input name="condition" type="text" placeholder="Good" className="input" />
          </label>
        </div>

        <label className="field">
          URL (optional)
          <input name="url" type="url" placeholder="https://…" className="input" />
        </label>

        <label className="field">
          Recency (optional)
          <input name="recency" type="text" placeholder="Sold last week" className="input" />
        </label>

        {state.error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{state.error}</p>}

        <button type="submit" disabled={pending} className="btn btn-secondary self-start">
          {pending ? "Adding…" : "Add comparable"}
        </button>
      </form>
    </details>
  );
}
