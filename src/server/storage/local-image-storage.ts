import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { ImageStorage, SavedImage } from "./image-storage";

// Private, NOT under public/ — nothing here is reachable by a direct HTTP
// request. The only way to read a photo's bytes is through the
// authenticated, ownership-checked /api/photos/[id] route, which resolves
// the DB-stored storageKey through this same module.
//
// Root is "storage" (not "storage/uploads"): storageKey values already
// carry a leading "uploads/" segment (unchanged since the pre-migration
// public/uploads/ layout), so existing rows keep resolving correctly
// without a data migration — only the files moved, the keys didn't.
const UPLOAD_ROOT = path.join(process.cwd(), "storage");

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Resolves a storageKey to an absolute path guaranteed to stay inside
 * UPLOAD_ROOT, regardless of the key's content. storageKey is never
 * client-supplied in practice (it's only ever produced by save() below and
 * read back out of the database), but every accessor still goes through
 * this guard as defense in depth against path traversal / arbitrary file
 * reads — a value like "../../../../etc/passwd" resolves outside the root
 * and is rejected before touching the filesystem.
 */
function resolveStoragePath(storageKey: string): string {
  const resolved = path.resolve(UPLOAD_ROOT, storageKey);
  const rootWithSep = UPLOAD_ROOT.endsWith(path.sep) ? UPLOAD_ROOT : UPLOAD_ROOT + path.sep;
  if (resolved !== UPLOAD_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

/**
 * Dev-only local filesystem storage under a private storage/ root (outside
 * public/, so nothing here is directly web-servable). Fine for an MVP; a
 * Cloudinary/S3 implementation of ImageStorage can replace this later
 * without changing call sites.
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
    const storageKey = path.posix.join("uploads", folder, filename);
    const absolutePath = resolveStoragePath(storageKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);

    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(resolveStoragePath(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    const absolutePath = resolveStoragePath(storageKey);
    await unlink(absolutePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
}
