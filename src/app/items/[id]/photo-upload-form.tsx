"use client";

import { useActionState } from "react";
import { addPhotosAction, type ItemFormState } from "../actions";

const initialState: ItemFormState = { error: null };

export function PhotoUploadForm({ itemId }: { itemId: string }) {
  const [state, formAction, pending] = useActionState(addPhotosAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          name="photos"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          className="input flex-1"
        />
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? "Uploading…" : "Add photos"}
        </button>
      </div>
      {state.error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{state.error}</p>}
    </form>
  );
}
