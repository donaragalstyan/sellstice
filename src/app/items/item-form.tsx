"use client";

import { useActionState } from "react";
import { ITEM_CONDITIONS } from "@/lib/validation";
import { ITEM_CONDITION_LABELS } from "@/lib/item-display";
import { createItemAction, updateItemAction, type ItemFormState } from "./actions";

const initialState: ItemFormState = { error: null };

interface ItemFormProps {
  mode: "create" | "edit";
  itemId?: string;
  defaultValues?: {
    brand?: string | null;
    color?: string | null;
    category?: string | null;
    size?: string | null;
    condition?: string | null;
    notableDetails?: string | null;
    acquisitionCostCents?: number | null;
  };
}

export function ItemForm({ mode, itemId, defaultValues }: ItemFormProps) {
  const action = mode === "create" ? createItemAction : updateItemAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {itemId && <input type="hidden" name="itemId" value={itemId} />}

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Brand
          <input
            name="brand"
            type="text"
            defaultValue={defaultValues?.brand ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Color
          <input
            name="color"
            type="text"
            defaultValue={defaultValues?.color ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Category
          <input
            name="category"
            type="text"
            placeholder="Sweater, jeans, sneakers…"
            defaultValue={defaultValues?.category ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Size
          <input
            name="size"
            type="text"
            defaultValue={defaultValues?.size ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Condition
        <select
          name="condition"
          defaultValue={defaultValues?.condition ?? ""}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Unknown</option>
          {ITEM_CONDITIONS.map((value) => (
            <option key={value} value={value}>
              {ITEM_CONDITION_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Notes
        <textarea
          name="notableDetails"
          rows={3}
          placeholder="Flaws, materials, anything worth remembering later…"
          defaultValue={defaultValues?.notableDetails ?? ""}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        What you paid for it (optional)
        <input
          name="acquisitionCost"
          type="number"
          min="0"
          step="0.01"
          defaultValue={
            defaultValues?.acquisitionCostCents != null
              ? defaultValues.acquisitionCostCents / 100
              : ""
          }
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </label>

      {mode === "create" && (
        <label className="flex flex-col gap-1 text-sm">
          Photos (optional, up to 8)
          <input
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : mode === "create" ? "Add item" : "Save changes"}
      </button>
    </form>
  );
}
