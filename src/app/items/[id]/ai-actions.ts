"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { imageStorage } from "@/server/storage";
import { inferImageMediaType } from "@/server/storage/image-validation";
import {
  analyzeItemPhotos,
  getAnalysisCooldownRemainingMs,
  mapAnalysisToCreateData,
  selectPhotosForAnalysis,
} from "@/server/ai/item-analysis";
import { AIProviderError } from "@/server/ai";
import type { ImageInput } from "@/server/ai";

export type AnalyzeState = { error: string | null };

const GENERIC_FAILURE_MESSAGE =
  "AI analysis is temporarily unavailable. You can still fill in item details manually.";

export async function analyzeItemAction(itemId: string): Promise<AnalyzeState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      photos: { orderBy: { order: "asc" } },
      aiAnalyses: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };
  if (item.photos.length === 0) {
    return { error: "Add at least one photo before analyzing." };
  }

  const cooldownRemainingMs = getAnalysisCooldownRemainingMs(
    item.aiAnalyses[0]?.createdAt ?? null,
    new Date(),
  );
  if (cooldownRemainingMs > 0) {
    return {
      error: `This item was just analyzed. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`,
    };
  }

  const photosToAnalyze = selectPhotosForAnalysis(item.photos);

  let images: ImageInput[];
  try {
    images = await Promise.all(
      photosToAnalyze.map(async (photo) => {
        const mediaType = inferImageMediaType(photo.storageKey);
        if (!mediaType) {
          throw new Error(`Unsupported stored image type for photo ${photo.id}`);
        }
        const buffer = await imageStorage.read(photo.storageKey);
        return { base64: buffer.toString("base64"), mediaType };
      }),
    );
  } catch (err) {
    console.error("Failed to load photos for AI analysis", err);
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  try {
    const result = await analyzeItemPhotos(images);
    await prisma.itemAIAnalysis.create({ data: mapAnalysisToCreateData(itemId, result) });
  } catch (err) {
    if (err instanceof AIProviderError) {
      console.error("AI provider error during item analysis:", err.message, err.cause);
    } else {
      console.error("Unexpected error during item analysis:", err);
    }
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}

export type AppliableField = "brand" | "color" | "category" | "condition";

export async function applySuggestionAction(
  itemId: string,
  analysisId: string,
  field: AppliableField,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const analysis = await prisma.itemAIAnalysis.findUnique({
    where: { id: analysisId },
    include: { item: true },
  });
  if (!analysis || analysis.itemId !== itemId || analysis.item.userId !== session.user.id) {
    return;
  }

  switch (field) {
    case "brand":
      if (analysis.brandValue == null) return;
      await prisma.item.update({ where: { id: itemId }, data: { brand: analysis.brandValue } });
      break;
    case "color":
      if (analysis.colorValue == null) return;
      await prisma.item.update({ where: { id: itemId }, data: { color: analysis.colorValue } });
      break;
    case "category":
      if (analysis.categoryValue == null) return;
      await prisma.item.update({
        where: { id: itemId },
        data: { category: analysis.categoryValue },
      });
      break;
    case "condition":
      if (analysis.conditionValue == null) return;
      await prisma.item.update({
        where: { id: itemId },
        data: { condition: analysis.conditionValue },
      });
      break;
  }

  if (!analysis.appliedFields.includes(field)) {
    await prisma.itemAIAnalysis.update({
      where: { id: analysisId },
      data: { appliedFields: [...analysis.appliedFields, field] },
    });
  }

  revalidatePath(`/items/${itemId}`);
}
