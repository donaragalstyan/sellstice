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
      <summary className="cursor-pointer text-gray-600">Add a comparable manually</summary>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="itemId" value={itemId} />

        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            name="title"
            type="text"
            required
            placeholder="Zara Cream Knit Sweater Size M"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Marketplace
            <input
              name="marketplace"
              type="text"
              placeholder="Poshmark"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Price (USD)
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Price type
            <select
              name="priceType"
              defaultValue="UNKNOWN"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {COMPARABLE_PRICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PRICE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Condition
            <input
              name="condition"
              type="text"
              placeholder="Good"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          URL (optional)
          <input
            name="url"
            type="url"
            placeholder="https://…"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Recency (optional)
          <input
            name="recency"
            type="text"
            placeholder="Sold last week"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add comparable"}
        </button>
      </form>
    </details>
  );
}
