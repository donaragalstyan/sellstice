"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasEnoughAttributesToResearch } from "@/server/research/comparables";
import {
  assessSellTiming,
  buildGoalSignal,
  getSellTimingCooldownRemainingMs,
  mapSellTimingToCreateData,
  summarizeComparablesForSellTiming,
  SellTimingProviderError,
  type SellTimingSignals,
} from "@/server/ai/sell-timing";

export type SellTimingState = { error: string | null };

const GENERIC_FAILURE_MESSAGE =
  "The sell-timing recommendation is temporarily unavailable. Try again shortly.";

export async function assessSellTimingAction(itemId: string): Promise<SellTimingState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be logged in." };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: {
      comparableListings: true,
      sellTimingAnalyses: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!item || item.userId !== session.user.id) return { error: "Item not found." };

  const canAssess = hasEnoughAttributesToResearch({
    brand: item.brand,
    color: null,
    category: item.category,
    size: null,
    condition: null,
    notableDetails: null,
  });
  if (!canAssess) {
    return { error: "Add a brand or category first so there's something to base a recommendation on." };
  }

  const cooldownRemainingMs = getSellTimingCooldownRemainingMs(
    item.sellTimingAnalyses[0]?.createdAt ?? null,
    new Date(),
  );
  if (cooldownRemainingMs > 0) {
    return {
      error: `A recommendation was just generated. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`,
    };
  }

  const goal = await prisma.goal.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const signals: SellTimingSignals = {
    brand: item.brand,
    category: item.category,
    condition: item.condition,
    comparables: summarizeComparablesForSellTiming(item.comparableListings),
    goal: buildGoalSignal(goal, now),
    now,
  };

  try {
    const result = await assessSellTiming(signals);
    await prisma.sellTimingAnalysis.create({ data: mapSellTimingToCreateData(itemId, result) });
  } catch (err) {
    if (err instanceof SellTimingProviderError) {
      console.error("Sell-timing provider error:", err.message, err.cause);
    } else {
      console.error("Unexpected error during sell-timing assessment:", err);
    }
    return { error: GENERIC_FAILURE_MESSAGE };
  }

  revalidatePath(`/items/${itemId}`);
  return { error: null };
}
