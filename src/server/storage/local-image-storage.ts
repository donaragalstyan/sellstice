import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { ImageStorage, SavedImage } from "./image-storage";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Dev-only local filesystem storage under public/uploads, served directly
 * by Next.js's static file handling. Fine for an MVP where photos are
 * unlisted-item pictures, not sensitive data — a Cloudinary/S3 implementation
 * of ImageStorage can replace this later without changing call sites.
 */
export class LocalImageStorage implements ImageStorage {
  async save({
    buffer,
    contentType,
    folder,
  }: {
    buffer: Buffer;
    contentType: string;
    folder: string;
  }): Promise<SavedImage> {
    const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
    const filename = `${randomUUID()}.${extension}`;
    const relativePath = path.posix.join("uploads", folder, filename);
    const absoluteDir = path.join(UPLOAD_ROOT, folder);

    await mkdir(absoluteDir, { recursive: true });
    await writeFile(path.join(absoluteDir, filename), buffer);

    return { url: `/${relativePath}`, storageKey: relativePath };
  }

  async delete(storageKey: string): Promise<void> {
    const safeKey = path.posix.normalize(storageKey);
    if (safeKey.startsWith("..") || path.isAbsolute(safeKey)) {
      throw new Error("Invalid storage key");
    }
    const absolutePath = path.join(process.cwd(), "public", safeKey);
    await unlink(absolutePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
}
