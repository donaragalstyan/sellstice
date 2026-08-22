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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="field">
          Brand
          <input name="brand" type="text" defaultValue={defaultValues?.brand ?? ""} className="input" />
        </label>
        <label className="field">
          Color
          <input name="color" type="text" defaultValue={defaultValues?.color ?? ""} className="input" />
        </label>
        <label className="field">
          Category
          <input
            name="category"
            type="text"
            placeholder="Sweater, jeans, sneakers…"
            defaultValue={defaultValues?.category ?? ""}
            className="input"
          />
        </label>
        <label className="field">
          Size
          <input name="size" type="text" defaultValue={defaultValues?.size ?? ""} className="input" />
        </label>
      </div>

      <label className="field">
        Condition
        <select name="condition" defaultValue={defaultValues?.condition ?? ""} className="input">
          <option value="">Unknown</option>
          {ITEM_CONDITIONS.map((value) => (
            <option key={value} value={value}>
              {ITEM_CONDITION_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Notes
        <textarea
          name="notableDetails"
          rows={3}
          placeholder="Flaws, materials, anything worth remembering later…"
          defaultValue={defaultValues?.notableDetails ?? ""}
          className="input"
        />
      </label>

      <label className="field">
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
          className="input"
        />
      </label>

      {mode === "create" && (
        <label className="field">
          Photos (optional, up to 8)
          <input
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            multiple
            className="input"
          />
        </label>
      )}

      {state.error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{state.error}</p>}

      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Saving…" : mode === "create" ? "Add item" : "Save changes"}
      </button>
    </form>
  );
}
