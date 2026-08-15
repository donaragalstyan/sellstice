"use client";

import { useActionState } from "react";
import { addPhotosAction, type ItemFormState } from "../actions";

const initialState: ItemFormState = { error: null };

export function PhotoUploadForm({ itemId }: { itemId: string }) {
  const [state, formAction, pending] = useActionState(addPhotosAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      <div className="flex items-center gap-2">
        <input
          name="photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Uploading…" : "Add photos"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
