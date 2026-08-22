"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { imageStorage } from "@/server/storage";
import { MAX_IMAGE_BYTES, validateImageFile, assertPhotoCountWithinLimit } from "@/server/storage/image-validation";
import { looksLikeHeic, convertHeicToJpeg, HeicConversionError } from "@/server/storage/heic";

export type ItemFormState = { error: string | null };

function readItemFields(formData: FormData) {
  return {
    brand: formData.get("brand") || undefined,
    color: formData.get("color") || undefined,
    category: formData.get("category") || undefined,
    size: formData.get("size") || undefined,
    condition: formData.get("condition") || undefined,
    notableDetails: formData.get("notableDetails") || undefined,
    acquisitionCost: formData.get("acquisitionCost") || undefined,
  };
}

function getUploadedFiles(formData: FormData): File[] {
  return formData
    .getAll("photos")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

interface PreparedPhoto {
  buffer: Buffer;
  contentType: string;
}

/**
 * Browsers report wildly inconsistent (often empty) MIME types for HEIC
 * files, so detection here is by magic bytes (looksLikeHeic), not file.type
 * — see heic.ts. A HEIC file is transcoded to JPEG before it ever reaches
 * validateImageFile/imageStorage: nothing downstream (the gallery, the
 * authenticated photo route, AI photo analysis) needs to know HEIC was ever
 * involved, since Claude's vision API and most browsers can't render it
 * directly anyway.
 */
async function preparePhotoForUpload(
  file: File,
): Promise<{ ok: true; photo: PreparedPhoto } | { ok: false; error: string }> {
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 8MB or smaller." };

  const raw = Buffer.from(await file.arrayBuffer());

  if (!looksLikeHeic(raw)) {
    const validation = validateImageFile({ type: file.type, size: raw.length });
    if (!validation.ok) return { ok: false, error: validation.error };
    return { ok: true, photo: { buffer: raw, contentType: file.type } };
  }

  let converted: Buffer;
  try {
    converted = await convertHeicToJpeg(raw);
  } catch (err) {
    if (err instanceof HeicConversionError) {
      console.error("HEIC conversion failed:", err.message, err.cause);
    } else {
      console.error("Unexpected error converting a HEIC photo:", err);
    }
    return { ok: false, error: "Could not process this HEIC photo. Try a different photo, or convert it first." };
  }

  const validation = validateImageFile({ type: "image/jpeg", size: converted.length });
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, photo: { buffer: converted, contentType: "image/jpeg" } };
}

/** Validates (and HEIC-transcodes) every file up front, before any DB rows
 * exist — call order matters here: a bad file must never leave an orphaned
 * Item, or a partially-saved photo batch, behind. */
async function prepareUploadedPhotos(
  files: File[],
): Promise<{ ok: true; photos: PreparedPhoto[] } | { ok: false; error: string }> {
  const photos: PreparedPhoto[] = [];
  for (const file of files) {
    const result = await preparePhotoForUpload(file);
    if (!result.ok) return { ok: false, error: result.error };
    photos.push(result.photo);
  }
  return { ok: true, photos };
}

async function savePreparedPhotos(photos: PreparedPhoto[], folder: string, startOrder: number) {
  const saved: { storageKey: string; order: number }[] = [];
  for (const [index, photo] of photos.entries()) {
    const savedImage = await imageStorage.save({ buffer: photo.buffer, contentType: photo.contentType, folder });
    saved.push({ ...savedImage, order: startOrder + index });
  }
  return saved;
}

export async function createItemAction(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const parsed = itemSchema.safeParse(readItemFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const files = getUploadedFiles(formData);
  const countCheck = assertPhotoCountWithinLimit(0, files.length);
  if (!countCheck.ok) return { error: countCheck.error };
  const prepared = await prepareUploadedPhotos(files);
  if (!prepared.ok) return { error: prepared.error };

  const item = await prisma.item.create({
    data: {
      userId: session.user.id,
      brand: parsed.data.brand,
      color: parsed.data.color,
      category: parsed.data.category,
      size: parsed.data.size,
      condition: parsed.data.condition,
      notableDetails: parsed.data.notableDetails,
      acquisitionCostCents:
        parsed.data.acquisitionCost !== undefined
          ? Math.round(parsed.data.acquisitionCost * 100)
          : undefined,
    },
  });

  if (prepared.photos.length > 0) {
    const saved = await savePreparedPhotos(prepared.photos, item.id, 0);
    await prisma.itemPhoto.createMany({
      data: saved.map((photo) => ({ itemId: item.id, ...photo })),
    });
  }

  revalidatePath("/items");
  redirect(`/items/${item.id}`);
}

export async function updateItemAction(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const itemId = formData.get("itemId");
  if (typeof itemId !== "string") return { error: "Item not found." };

  const existing = await prisma.item.findUnique({ where: { id: itemId } });
  if (!existing || existing.userId !== session.user.id) return { error: "Item not found." };

  const parsed = itemSchema.safeParse(readItemFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await prisma.item.update({
    where: { id: itemId },
    data: {
      brand: parsed.data.brand ?? null,
      color: parsed.data.color ?? null,
      category: parsed.data.category ?? null,
      size: parsed.data.size ?? null,
      condition: parsed.data.condition ?? null,
      notableDetails: parsed.data.notableDetails ?? null,
      acquisitionCostCents:
        parsed.data.acquisitionCost !== undefined
          ? Math.round(parsed.data.acquisitionCost * 100)
          : null,
    },
  });

  revalidatePath(`/items/${itemId}`);
  revalidatePath("/items");
  return { error: null };
}

export async function addPhotosAction(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const itemId = formData.get("itemId");
  if (typeof itemId !== "string") return { error: "Item not found." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { _count: { select: { photos: true } } },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };

  const files = getUploadedFiles(formData);
  if (files.length === 0) return { error: "Choose at least one photo." };

  const countCheck = assertPhotoCountWithinLimit(item._count.photos, files.length);
  if (!countCheck.ok) return { error: countCheck.error };
  const prepared = await prepareUploadedPhotos(files);
  if (!prepared.ok) return { error: prepared.error };

  const saved = await savePreparedPhotos(prepared.photos, itemId, item._count.photos);
  await prisma.itemPhoto.createMany({
    data: saved.map((photo) => ({ itemId, ...photo })),
  });

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}

// Ownership-checked core, factored out of deletePhotoAction so cross-user
// authorization can be tested directly with an explicit userId — no auth()
// mocking or Next.js request/navigation context required (revalidatePath()
// needs a live Next request context, so it deliberately stays out of this
// function and lives in the thin action wrapper below instead). Returns the
// deleted photo's itemId, or null if nothing was deleted — the
// "unauthorized/not found" case silently no-ops by design (see the header
// note on deletePhotoAction for why callers don't get an error message).
export async function deletePhotoForUser(photoId: string, userId: string): Promise<string | null> {
  const photo = await prisma.itemPhoto.findUnique({
    where: { id: photoId },
    include: { item: true },
  });
  if (!photo || photo.item.userId !== userId) return null;

  await prisma.itemPhoto.delete({ where: { id: photoId } });
  await imageStorage.delete(photo.storageKey);

  return photo.itemId;
}

export async function deletePhotoAction(photoId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const itemId = await deletePhotoForUser(photoId, session.user.id);
  if (itemId) revalidatePath(`/items/${itemId}`);
}

// Same split as deletePhotoForUser above — testable without auth()/Next
// request context. The redirect() on a successful delete only happens in
// deleteItemAction itself, so calling this directly (e.g. for an
// unauthorized cross-user attempt, which returns false before any mutation)
// never triggers Next.js's redirect-via-throw behavior.
export async function deleteItemForUser(itemId: string, userId: string): Promise<boolean> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: true },
  });
  if (!item || item.userId !== userId) return false;

  await prisma.item.delete({ where: { id: itemId } });
  await Promise.all(item.photos.map((photo) => imageStorage.delete(photo.storageKey)));

  return true;
}

export async function deleteItemAction(itemId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const deleted = await deleteItemForUser(itemId, session.user.id);
  if (deleted) {
    revalidatePath("/items");
    redirect("/items");
  }
}
