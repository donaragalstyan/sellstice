"use client";

import { useTransition } from "react";
import { deletePhotoAction } from "../actions";

interface Photo {
  id: string;
  url: string;
}

export function PhotoGallery({ photos }: { photos: Photo[] }) {
  const [pending, startTransition] = useTransition();

  if (photos.length === 0) {
    return <p className="text-sm text-gray-500">No photos yet.</p>;
  }

  return (
    <ul className="grid grid-cols-4 gap-3">
      {photos.map((photo) => (
        <li key={photo.id} className="group relative aspect-square overflow-hidden rounded-md bg-gray-100 dark:bg-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => deletePhotoAction(photo.id))}
            className="absolute top-1 right-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-black/90 disabled:opacity-50 group-hover:opacity-100"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
