export interface SavedImage {
  url: string;
  storageKey: string;
}

/**
 * Storage is deliberately behind this interface so the local filesystem
 * implementation used in dev can be swapped for Cloudinary (or S3/R2)
 * without touching any call sites.
 */
export interface ImageStorage {
  save(params: { buffer: Buffer; contentType: string; folder: string }): Promise<SavedImage>;
  delete(storageKey: string): Promise<void>;
}
