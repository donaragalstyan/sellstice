import { z } from "zod";
import { AnthropicProvider } from "@/server/ai";
import type { ImageInput } from "@/server/ai";
import { getCooldownRemainingMs } from "@/server/ai/cooldown";

// Photo Coach is scored/critiqued output across up to 8 images (items can
// have at most that many photos), so it needs more output room than the
// single-object item-analysis response — configured independently, per
// capability, same as the model choice below.
const MAX_TOKENS = 4096;

// Chosen independently from item analysis (its own env var, its own
// AnthropicProvider instance) even though the current default happens to
// match: this is also a bounded, well-specified task (fixed schema, short
// per-photo critique), so the cheapest vision-capable model that supports
// structured outputs is the right starting point. Override via env if
// quality turns out to be too weak for qualitative photo critique.
export const DEFAULT_MODEL = "claude-haiku-4-5";
const MODEL = process.env.PHOTO_COACH_AI_MODEL?.trim() || DEFAULT_MODEL;
const MODEL_ID = `anthropic:${MODEL}`;

const provider = new AnthropicProvider(MODEL, MAX_TOKENS);

/**
 * Minimum time between photo-coach runs on the same item. Same rationale as
 * item analysis's cooldown (see item-analysis.ts) — server-side backstop
 * against double-clicks, extra tabs, or a direct call to the server action,
 * independent of the client-side button-disable.
 */
export const PHOTO_COACH_COOLDOWN_MS = 30_000;

export function getPhotoCoachCooldownRemainingMs(
  lastRunAt: Date | null,
  now: Date,
  cooldownMs = PHOTO_COACH_COOLDOWN_MS,
): number {
  return getCooldownRemainingMs(lastRunAt, now, cooldownMs);
}

export const MISSING_SHOT_TYPES = [
  "BRAND_TAG",
  "SIZE_TAG",
  "MATERIAL_TAG",
  "BACK_VIEW",
  "FLAW_CLOSEUP",
  "MODELED_PHOTO",
  "FLAT_LAY",
] as const;

const feedbackField = () =>
  z.object({
    ok: z.boolean(),
    feedback: z.string().nullable(),
  });

const photoCoachPhotoSchema = z.object({
  photoNumber: z.number().int(),
  score: z.number(),
  isBestCover: z.boolean(),
  lighting: feedbackField(),
  framing: feedbackField(),
  background: feedbackField(),
  shapeVisible: feedbackField(),
});

export const photoCoachSchema = z.object({
  photos: z.array(photoCoachPhotoSchema),
  missingShots: z.array(z.enum(MISSING_SHOT_TYPES)),
});

export type PhotoCoachResult = z.infer<typeof photoCoachSchema>;
export type PhotoCoachPhotoResult = z.infer<typeof photoCoachPhotoSchema>;

export const PHOTO_COACH_INSTRUCTIONS = `You are a photo coach helping a seller improve their resale-listing photos. You will see this item's current photos, numbered Photo 1 through Photo N in the order given.

For each photo, return an entry with that same photoNumber and:
- score: an overall quality score from 0 to 10 for how well this photo works as a resale-listing photo (framing, lighting, clarity — one decimal place is fine, e.g. 8.7).
- isBestCover: true for the single photo you'd recommend as the listing's cover/first photo, false for all others. Exactly one photo should be true.
- lighting: ok=true if lighting is acceptable; if not, ok=false and feedback is a short phrase completing the sentence "Photo N ___", e.g. "is too dark" or "is overexposed near the top".
- framing: ok=true if framing/cropping is acceptable; if not, ok=false and feedback completes "Photo N ___", e.g. "crops the hem" or "is too far from the item to see detail".
- background: ok=true if the background is clean and non-distracting; if not, ok=false and feedback completes "Photo N ___", e.g. "has a cluttered background" or "shows distracting objects behind the item".
- shapeVisible: ok=true if the item's shape and details are clearly visible in this photo; if not, ok=false and feedback completes "Photo N ___", e.g. "doesn't show the item's actual shape" or "is too close to see the overall silhouette".

Only mark ok=false when there's a real, specific issue visible in that photo — do not invent flaws, and leave feedback null whenever ok is true.

Then, looking at the whole set of photos together, list which of these shot types would meaningfully improve the listing if added: BRAND_TAG (a photo of the brand tag/label), SIZE_TAG (a photo of the size tag), MATERIAL_TAG (a photo of the fabric/care label), BACK_VIEW (a full view of the back of the item), FLAW_CLOSEUP (a close-up of any visible flaw, if one is visible in these photos), MODELED_PHOTO (the item worn or modeled), FLAT_LAY (a clean flat lay of the whole item). Only include shot types that are genuinely missing and would help — return an empty list if the current set is already comprehensive. Do not suggest FLAW_CLOSEUP unless a flaw is actually visible somewhere in the provided photos.

You are giving advice only. Do not describe how to edit, retouch, or regenerate any photo — only how the seller could shoot a better one.`;

export async function analyzePhotoCoach(images: ImageInput[]): Promise<PhotoCoachResult> {
  return provider.analyzeImages({
    images,
    instructions: PHOTO_COACH_INSTRUCTIONS,
    schema: photoCoachSchema,
  });
}

/**
 * The model is asked to flag exactly one photo as best cover, but structured
 * output isn't a guarantee — if it flags zero or more than one, fall back to
 * the highest-scoring photo deterministically rather than trusting the flag
 * or wasting another API call on a retry.
 */
export function determineBestCoverIndex(
  photos: { score: number; isBestCover: boolean }[],
): number {
  const flagged = photos.filter((p) => p.isBestCover);
  if (flagged.length === 1) {
    return photos.indexOf(flagged[0]);
  }
  let bestIndex = 0;
  for (let i = 1; i < photos.length; i++) {
    if (photos[i].score > photos[bestIndex].score) bestIndex = i;
  }
  return bestIndex;
}

/**
 * Deterministic guard against a malformed response before anything is
 * written to the database: the model must return exactly one entry per
 * photo sent, numbered 1..N with no gaps or duplicates.
 */
export function validatePhotoCoachPhotoNumbers(
  photoNumbers: number[],
  expectedCount: number,
): boolean {
  if (photoNumbers.length !== expectedCount) return false;
  const seen = new Set(photoNumbers);
  if (seen.size !== expectedCount) return false;
  for (let n = 1; n <= expectedCount; n++) {
    if (!seen.has(n)) return false;
  }
  return true;
}

export function mapPhotoCoachToCreateData(
  itemId: string,
  photos: { id: string; order: number }[],
  result: PhotoCoachResult,
) {
  const bestIndex = determineBestCoverIndex(
    result.photos.map((p) => ({ score: p.score, isBestCover: p.isBestCover })),
  );

  return {
    itemId,
    missingShots: result.missingShots,
    modelId: MODEL_ID,
    scores: {
      create: result.photos.map((p, i) => {
        const photo = photos[p.photoNumber - 1];
        return {
          photoId: photo.id,
          photoOrder: photo.order,
          score: p.score,
          isBestCover: i === bestIndex,
          lightingOk: p.lighting.ok,
          lightingFeedback: p.lighting.feedback,
          framingOk: p.framing.ok,
          framingFeedback: p.framing.feedback,
          backgroundOk: p.background.ok,
          backgroundFeedback: p.background.feedback,
          shapeVisibleOk: p.shapeVisible.ok,
          shapeVisibleFeedback: p.shapeVisible.feedback,
        };
      }),
    },
  };
}
