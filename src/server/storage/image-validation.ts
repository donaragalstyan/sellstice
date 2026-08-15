export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_ITEM = 8;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ImageFileDescriptor {
  type: string;
  size: number;
}

export type ImageValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Pure validation so it's testable without constructing real File/Blob
 * objects. Called once per uploaded file before it ever touches disk.
 */
export function validateImageFile(file: ImageFileDescriptor): ImageValidationResult {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { ok: false, error: "Only JPEG, PNG, or WebP images are allowed." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Images must be 8MB or smaller." };
  }
  return { ok: true };
}

export function assertPhotoCountWithinLimit(existingCount: number, incomingCount: number): ImageValidationResult {
  if (existingCount + incomingCount > MAX_PHOTOS_PER_ITEM) {
    return {
      ok: false,
      error: `Items can have at most ${MAX_PHOTOS_PER_ITEM} photos (${existingCount} already uploaded).`,
    };
  }
  return { ok: true };
}
