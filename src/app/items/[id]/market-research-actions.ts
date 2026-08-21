"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { manualComparableSchema } from "@/lib/validation";
import { imageStorage } from "@/server/storage";
import { inferImageMediaType } from "@/server/storage/image-validation";
import { selectPhotosForAnalysis } from "@/server/ai/item-analysis";
import type { ImageInput } from "@/server/ai";
import {
  findComparableListings,
  mapComparablesToCreateData,
  deduplicateComparables,
  deduplicateAgainstExisting,
  assessComparableQuality,
  getMarketResearchCooldownRemainingMs,
  getRefinementCooldownRemainingMs,
  hasEnoughAttributesToResearch,
  type ComparableKeyFields,
  type QualityFields,
} from "@/server/research/comparables";
import { MarketResearchProviderError, type ComparableSearchResult, type MarketResearchQuery } from "@/server/research/provider";
import { runRefinementAgent, type RefinementOutcome } from "@/server/research/agent/refine-comparables-agent";

export type MarketResearchState = { error: string | null };

const GENERIC_FAILURE_MESSAGE =
  "Market research is temporarily unavailable. You can still add comparables manually.";

const COMPARABLE_LISTING_SELECT = {
  url: true,
  title: true,
  marketplace: true,
  priceCents: true,
  source: true,
  matchConfidence: true,
  priceEvidence: true,
  visualSimilarity: true,
} as const;

type StoredComparableFields = ComparableKeyFields & QualityFields;

/**
 * Shared by researchComparablesAction and refineComparablesAction: dedupes
 * newly discovered results against everything already stored for the item
 * and writes them as one ComparableResearchRun (+ ComparableListing rows).
 * Returns just the newly added results.
 */
async function persistNewComparables(
  itemId: string,
  query: MarketResearchQuery,
  existingComps: ComparableKeyFields[],
  rawResults: ComparableSearchResult[],
): Promise<ComparableSearchResult[]> {
  const withinBatch = deduplicateComparables(rawResults);
  const newResults = deduplicateAgainstExisting(existingComps, withinBatch);
  await prisma.comparableResearchRun.create({
    data: {
      itemId,
      querySnapshot: query as unknown as Prisma.InputJsonValue,
      resultCount: newResults.length,
      listings: { create: mapComparablesToCreateData(itemId, newResults) },
    },
  });
  return newResults;
}

/**
 * Best-effort: a photo-loading failure must not block text-based research
 * from running at all — Stage 2 visual confirmation is an enhancement, same
 * reasoning as its own internal failure handling in providers/brave-discovery.ts.
 */
async function loadItemPhotosForResearch(photos: { id: string; storageKey: string }[]): Promise<ImageInput[]> {
  try {
    return await Promise.all(
      selectPhotosForAnalysis(photos).map(async (photo) => {
        const mediaType = inferImageMediaType(photo.storageKey);
        if (!mediaType) {
          throw new Error(`Unsupported stored image type for photo ${photo.id}`);
        }
        const buffer = await imageStorage.read(photo.storageKey);
        return { base64: buffer.toString("base64"), mediaType };
      }),
    );
  } catch (err) {
    console.error("Failed to load item photos for visual comparable matching:", err);
    return [];
  }
}

export async function researchComparablesAction(itemId: string): Promise<MarketResearchState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      researchRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      comparableListings: { select: COMPARABLE_LISTING_SELECT },
      photos: { orderBy: { order: "asc" } },
    },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };

  const query: MarketResearchQuery = {
    brand: item.brand,
    color: item.color,
    category: item.category,
    size: item.size,
    condition: item.condition,
    notableDetails: item.notableDetails,
  };
  if (!hasEnoughAttributesToResearch(query)) {
    return { error: "Add at least a brand or category before researching comparables." };
  }

  const cooldownRemainingMs = getMarketResearchCooldownRemainingMs(
    item.researchRuns[0]?.createdAt ?? null,
    new Date(),
  );
  if (cooldownRemainingMs > 0) {
    return {
      error: `Comparables were just researched. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`,
    };
  }

  const itemPhotos = await loadItemPhotosForResearch(item.photos);

  try {
    const raw = await findComparableListings(query, itemPhotos);
    await persistNewComparables(itemId, query, item.comparableListings, raw);
  } catch (err) {
    if (err instanceof MarketResearchProviderError) {
      console.error("Market research provider error:", err.message, err.cause);
    } else {
      console.error("Unexpected error during market research:", err);
    }
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}

export type RefineComparablesState = { error: string | null; outcome?: RefinementOutcome };

/**
 * The comp-quality refinement agent (src/server/research/agent/refine-comparables-agent.ts):
 * a bounded, tool-calling Claude agent that decides which alternate search
 * strategy is worth trying when the normal research run comes back with too
 * few reliable comparables. Explicit, separate action from
 * researchComparablesAction — each retry re-runs the full pipeline, so this
 * is opt-in and its own (longer) cooldown, never automatic.
 */
export async function refineComparablesAction(itemId: string): Promise<RefineComparablesState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      researchRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      comparableListings: { select: COMPARABLE_LISTING_SELECT },
      photos: { orderBy: { order: "asc" } },
    },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };

  const query: MarketResearchQuery = {
    brand: item.brand,
    color: item.color,
    category: item.category,
    size: item.size,
    condition: item.condition,
    notableDetails: item.notableDetails,
  };
  if (!hasEnoughAttributesToResearch(query)) {
    return { error: "Add at least a brand or category before researching comparables." };
  }

  if (assessComparableQuality(item.comparableListings).sufficient) {
    return { error: "Already sufficient — nothing to refine." };
  }

  const cooldownRemainingMs = getRefinementCooldownRemainingMs(
    item.researchRuns[0]?.createdAt ?? null,
    new Date(),
  );
  if (cooldownRemainingMs > 0) {
    return {
      error: `Comparables were just refined. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`,
    };
  }

  const itemPhotos = await loadItemPhotosForResearch(item.photos);

  let outcome: RefinementOutcome;
  try {
    outcome = await runRefinementAgent({
      originalQuery: query,
      itemPhotos,
      baselineComps: item.comparableListings,
      runResearch: findComparableListings,
      persistIteration: async (modifiedQuery, rawResults): Promise<QualityFields[]> => {
        const existing: StoredComparableFields[] = await prisma.comparableListing.findMany({
          where: { itemId },
          select: COMPARABLE_LISTING_SELECT,
        });
        await persistNewComparables(itemId, modifiedQuery, existing, rawResults);
        return prisma.comparableListing.findMany({
          where: { itemId },
          select: {
            source: true,
            priceCents: true,
            matchConfidence: true,
            priceEvidence: true,
            visualSimilarity: true,
          },
        });
      },
    });
  } catch (err) {
    console.error("Refinement agent failed:", err);
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  revalidatePath(`/items/${itemId}`);
  return { error: null, outcome };
}

export type ManualComparableState = { error: string | null };

export async function addManualComparableAction(
  _prevState: ManualComparableState,
  formData: FormData,
): Promise<ManualComparableState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const itemId = formData.get("itemId");
  if (typeof itemId !== "string") return { error: "Item not found." };

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };

  const parsed = manualComparableSchema.safeParse({
    title: formData.get("title"),
    marketplace: formData.get("marketplace") || undefined,
    price: formData.get("price") || undefined,
    priceType: formData.get("priceType") || undefined,
    url: formData.get("url") || undefined,
    condition: formData.get("condition") || undefined,
    recency: formData.get("recency") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.comparableListing.create({
    data: {
      itemId,
      source: "MANUAL",
      title: parsed.data.title,
      marketplace: parsed.data.marketplace ?? null,
      priceCents:
        parsed.data.price !== undefined ? Math.round(parsed.data.price * 100) : null,
      priceType: parsed.data.priceType,
      url: parsed.data.url || null,
      condition: parsed.data.condition ?? null,
      recency: parsed.data.recency ?? null,
      // Not a model estimate — the user is the source, so there's no
      // match confidence to assign, and nothing to attribute automated
      // price evidence to either. Manual comps are excluded from the
      // matchConfidence gate for the same reason (see isUsableComparable).
      matchConfidence: null,
      priceEvidence: null,
    },
  });

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}

export async function deleteComparableAction(itemId: string, comparableId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const comparable = await prisma.comparableListing.findUnique({
    where: { id: comparableId },
    include: { item: true },
  });
  if (!comparable || comparable.itemId !== itemId || comparable.item.userId !== session.user.id) {
    return;
  }

  await prisma.comparableListing.delete({ where: { id: comparableId } });
  revalidatePath(`/items/${itemId}`);
}
