"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { manualComparableSchema } from "@/lib/validation";
import {
  findComparableListings,
  mapComparablesToCreateData,
  deduplicateComparables,
  deduplicateAgainstExisting,
  getMarketResearchCooldownRemainingMs,
  hasEnoughAttributesToResearch,
} from "@/server/research/comparables";
import { MarketResearchProviderError } from "@/server/research/provider";

export type MarketResearchState = { error: string | null };

const GENERIC_FAILURE_MESSAGE =
  "Market research is temporarily unavailable. You can still add comparables manually.";

export async function researchComparablesAction(itemId: string): Promise<MarketResearchState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      researchRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      comparableListings: { select: { url: true, title: true, marketplace: true, priceCents: true } },
    },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };

  const query = {
    brand: item.brand,
    color: item.color,
    category: item.category,
    size: item.size,
    condition: item.condition,
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

  let newResults;
  try {
    const raw = await findComparableListings(query);
    const withinBatch = deduplicateComparables(raw);
    // Also dedupe against everything already stored for this item, so
    // re-running research accumulates genuinely new listings instead of
    // re-inserting the same real-world result every time.
    newResults = deduplicateAgainstExisting(item.comparableListings, withinBatch);
  } catch (err) {
    if (err instanceof MarketResearchProviderError) {
      console.error("Market research provider error:", err.message, err.cause);
    } else {
      console.error("Unexpected error during market research:", err);
    }
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  await prisma.comparableResearchRun.create({
    data: {
      itemId,
      querySnapshot: query,
      resultCount: newResults.length,
      listings: { create: mapComparablesToCreateData(itemId, newResults) },
    },
  });

  revalidatePath(`/items/${itemId}`);
  return { error: null };
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
      // confidence score to assign. Manual comps are excluded from the
      // "usable" count for the same reason (see isUsableComparable).
      confidence: null,
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
