export interface SavedImage {
  storageKey: string;
}

/**
 * Storage is deliberately behind this interface so the local filesystem
 * implementation used in dev can be swapped for Cloudinary (or S3/R2)
 * without touching any call sites. There is no `url`/public-path concept
 * here on purpose — callers never get a browser-servable URL from storage
 * directly; serving is an authenticated, ownership-checked concern that
 * lives at the application boundary (see src/app/api/photos/[id]/route.ts),
 * not the storage layer.
 */
export interface ImageStorage {
  save(params: { buffer: Buffer; contentType: string; folder: string }): Promise<SavedImage>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}
