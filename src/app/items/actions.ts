"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { imageStorage } from "@/server/storage";
import { validateImageFile, assertPhotoCountWithinLimit } from "@/server/storage/image-validation";

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

function validateUploadedFiles(files: File[]): { error: string | null } {
  for (const file of files) {
    const validation = validateImageFile({ type: file.type, size: file.size });
    if (!validation.ok) return { error: validation.error };
  }
  return { error: null };
}

// Assumes files were already validated with validateUploadedFiles — call
// order matters here: we validate before creating any DB rows, specifically
// so a bad file can't leave an orphaned Item behind.
async function saveUploadedPhotos(files: File[], folder: string, startOrder: number) {
  const saved: { url: string; storageKey: string; order: number }[] = [];
  for (const [index, file] of files.entries()) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const savedImage = await imageStorage.save({ buffer, contentType: file.type, folder });
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
  const fileValidation = validateUploadedFiles(files);
  if (fileValidation.error) return { error: fileValidation.error };

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

  if (files.length > 0) {
    const saved = await saveUploadedPhotos(files, item.id, 0);
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
  const fileValidation = validateUploadedFiles(files);
  if (fileValidation.error) return { error: fileValidation.error };

  const saved = await saveUploadedPhotos(files, itemId, item._count.photos);
  await prisma.itemPhoto.createMany({
    data: saved.map((photo) => ({ itemId, ...photo })),
  });

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}

export async function deletePhotoAction(photoId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const photo = await prisma.itemPhoto.findUnique({
    where: { id: photoId },
    include: { item: true },
  });
  if (!photo || photo.item.userId !== session.user.id) return;

  await prisma.itemPhoto.delete({ where: { id: photoId } });
  await imageStorage.delete(photo.storageKey);

  revalidatePath(`/items/${photo.itemId}`);
}

export async function deleteItemAction(itemId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: true },
  });
  if (!item || item.userId !== session.user.id) return;

  await prisma.item.delete({ where: { id: itemId } });
  await Promise.all(item.photos.map((photo) => imageStorage.delete(photo.storageKey)));

  revalidatePath("/items");
  redirect("/items");
}
