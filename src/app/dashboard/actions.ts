"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { goalSchema } from "@/lib/validation";

export type GoalFormState = { error: string | null };

export async function saveGoalAction(
  _prevState: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be logged in." };
  }

  const parsed = goalSchema.safeParse({
    targetAmount: formData.get("targetAmount"),
    deadline: formData.get("deadline"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const targetAmountCents = Math.round(parsed.data.targetAmount * 100);
  const goalId = formData.get("goalId");

  if (typeof goalId === "string" && goalId.length > 0) {
    const existing = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!existing || existing.userId !== session.user.id) {
      return { error: "Goal not found." };
    }
    await prisma.goal.update({
      where: { id: goalId },
      data: { targetAmountCents, deadline: parsed.data.deadline },
    });
  } else {
    await prisma.goal.create({
      data: {
        userId: session.user.id,
        targetAmountCents,
        deadline: parsed.data.deadline,
      },
    });
  }

  revalidatePath("/dashboard");
  return { error: null };
}
