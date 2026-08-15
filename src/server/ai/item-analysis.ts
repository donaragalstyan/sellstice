import { z } from "zod";
import { ITEM_CONDITIONS } from "@/lib/validation";
import { AnthropicProvider } from "@/server/ai";
import type { ImageInput } from "@/server/ai";
import { getCooldownRemainingMs } from "@/server/ai/cooldown";

// Item analysis is a bounded, well-specified extraction task (fixed schema,
// short output) rather than open-ended reasoning, so it doesn't need a
// frontier model by default — Haiku is vision-capable, supports structured
// outputs, and costs a fraction of Opus/Sonnet for this shape of work.
// Override via env to benchmark a stronger model without a code change.
export const DEFAULT_MODEL = "claude-haiku-4-5";
const MODEL = process.env.ITEM_ANALYSIS_AI_MODEL?.trim() || DEFAULT_MODEL;
const MODEL_ID = `anthropic:${MODEL}`;

const provider = new AnthropicProvider(MODEL);

export const MAX_ANALYSIS_PHOTOS = 4;

/**
 * Minimum time between analyses of the same item. The Analyze button already
 * disables itself while a request is in flight, but that's client-side only
 * — a second tab, a fast double-click before React re-renders, or a stray
 * script hitting the server action directly wouldn't be stopped by it. This
 * is the server-side backstop, checked before any AI call is made.
 */
export const ANALYSIS_COOLDOWN_MS = 30_000;

export function getAnalysisCooldownRemainingMs(
  lastAnalyzedAt: Date | null,
  now: Date,
  cooldownMs = ANALYSIS_COOLDOWN_MS,
): number {
  return getCooldownRemainingMs(lastAnalyzedAt, now, cooldownMs);
}

const suggestedField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().nullable(),
  });

export const itemAnalysisSchema = z.object({
  brand: suggestedField(z.string()),
  color: suggestedField(z.string()),
  itemType: suggestedField(z.string()),
  category: suggestedField(z.string()),
  condition: suggestedField(z.enum(ITEM_CONDITIONS)),
  styleKeywords: z.array(z.string()),
  visibleDetails: z.array(z.string()),
  missingPhotoSuggestions: z.array(z.string()),
});

export type ItemAnalysisResult = z.infer<typeof itemAnalysisSchema>;

export const ANALYSIS_INSTRUCTIONS = `You are analyzing photos of a single secondhand item to help the seller draft a resale listing.

Only report what is visibly supported by the images. If the brand is not legible or not visible, set brand.value to null — never guess or infer a brand from style, cut, or general appearance alone. Apply the same rule to every other field: if you cannot support a value from what is visible in these specific photos, use null rather than guessing. Do not invent measurements, materials, or flaws that aren't visible.

For every field where you provide a value, include a confidence between 0 and 1 reflecting how certain you are given only these images.

For missingPhotoSuggestions, list specific additional photos that would materially improve the listing (for example: a tag/label close-up, a full back view, a material or care-label close-up, or a close-up of a visible flaw) — only suggest ones that seem genuinely missing given what's already shown, and return an empty list if the current photos are already sufficient.`;

/** Cap the number of images sent per analysis to control cost. */
export function selectPhotosForAnalysis<T>(photos: T[], max = MAX_ANALYSIS_PHOTOS): T[] {
  return photos.slice(0, max);
}

export async function analyzeItemPhotos(images: ImageInput[]): Promise<ItemAnalysisResult> {
  return provider.analyzeImages({
    images,
    instructions: ANALYSIS_INSTRUCTIONS,
    schema: itemAnalysisSchema,
  });
}

export function mapAnalysisToCreateData(itemId: string, result: ItemAnalysisResult) {
  return {
    itemId,
    brandValue: result.brand.value,
    brandConfidence: result.brand.confidence,
    colorValue: result.color.value,
    colorConfidence: result.color.confidence,
    itemTypeValue: result.itemType.value,
    itemTypeConfidence: result.itemType.confidence,
    categoryValue: result.category.value,
    categoryConfidence: result.category.confidence,
    conditionValue: result.condition.value,
    conditionConfidence: result.condition.confidence,
    styleKeywords: result.styleKeywords,
    visibleDetails: result.visibleDetails,
    missingPhotoSuggestions: result.missingPhotoSuggestions,
    modelId: MODEL_ID,
  };
}
