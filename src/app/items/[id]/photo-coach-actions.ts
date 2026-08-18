"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { imageStorage } from "@/server/storage";
import { inferImageMediaType } from "@/server/storage/image-validation";
import {
  analyzePhotoCoach,
  getPhotoCoachCooldownRemainingMs,
  mapPhotoCoachToCreateData,
  validatePhotoCoachPhotoNumbers,
} from "@/server/ai/photo-coach";
import { AIProviderError } from "@/server/ai";
import type { ImageInput } from "@/server/ai";

export type PhotoCoachState = { error: string | null };

const GENERIC_FAILURE_MESSAGE =
  "Photo coaching is temporarily unavailable. Your photos are unchanged — try again later.";

export async function analyzePhotoCoachAction(itemId: string): Promise<PhotoCoachState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      photos: { orderBy: { order: "asc" } },
      photoCoachAnalyses: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };
  if (item.photos.length === 0) {
    return { error: "Add at least one photo before requesting photo feedback." };
  }

  const cooldownRemainingMs = getPhotoCoachCooldownRemainingMs(
    item.photoCoachAnalyses[0]?.createdAt ?? null,
    new Date(),
  );
  if (cooldownRemainingMs > 0) {
    return {
      error: `Photos were just reviewed. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`,
    };
  }

  // Read-only: photo coaching only ever reads these files to build the
  // request. Nothing in this action writes to, edits, or replaces them.
  let images: ImageInput[];
  try {
    images = await Promise.all(
      item.photos.map(async (photo) => {
        const mediaType = inferImageMediaType(photo.storageKey);
        if (!mediaType) {
          throw new Error(`Unsupported stored image type for photo ${photo.id}`);
        }
        const buffer = await imageStorage.read(photo.storageKey);
        return { base64: buffer.toString("base64"), mediaType };
      }),
    );
  } catch (err) {
    console.error("Failed to load photos for photo coaching", err);
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  try {
    const result = await analyzePhotoCoach(images);
    const photoNumbers = result.photos.map((p) => p.photoNumber);
    if (!validatePhotoCoachPhotoNumbers(photoNumbers, item.photos.length)) {
      throw new AIProviderError("The model's response didn't match the photo set.");
    }
    const data = mapPhotoCoachToCreateData(itemId, item.photos, result);
    await prisma.photoCoachAnalysis.create({ data });
  } catch (err) {
    if (err instanceof AIProviderError) {
      console.error("AI provider error during photo coaching:", err.message, err.cause);
    } else {
      console.error("Unexpected error during photo coaching:", err);
    }
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}
