import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ImageInput } from "@/server/ai";
import { MarketResearchProviderError } from "../provider";

// Same model as the text-only Stage 1 (discovery/match-candidates.ts) —
// vision-capable, and already characterized for adaptive-thinking token
// overhead on this exact family of bounded structured-output judgment calls.
const DEFAULT_MODEL = "claude-sonnet-5";
const MODEL = process.env.MARKET_RESEARCH_VISUAL_MATCH_AI_MODEL?.trim() || DEFAULT_MODEL;
// Empirically sized: Stage 1 measured ~90 output tokens/candidate (including
// Sonnet 5's default adaptive thinking) over a 49-candidate pure-text batch.
// This call is capped to a small shortlist (~10 candidates, see
// providers/brave-discovery.ts) but each judgment now grounds in an actual
// image comparison rather than text alone, so headroom is kept generous
// rather than scaled down proportionally with the smaller candidate count.
const MAX_TOKENS = 8_000;

export interface VisualMatchCandidateInput {
  /** Index into the caller's own candidate list — echoed back by the model
   * so judgments can be matched up unambiguously despite interleaved images. */
  index: number;
  title: string;
  marketplace: string;
  image: ImageInput;
}

export interface VisualMatchJudgment {
  index: number;
  visualSimilarity: number;
  rationale: string | null;
}

const judgmentSchema = z.object({
  index: z.number().int(),
  visualSimilarity: z.number().min(0).max(1),
  rationale: z.string().nullable(),
});

const responseSchema = z.object({
  judgments: z.array(judgmentSchema),
});

function imageBlock(image: ImageInput): ContentBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.base64 },
  };
}

function buildContent(itemPhotos: ImageInput[], candidates: VisualMatchCandidateInput[]): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];

  content.push({
    type: "text",
    text: "The following photos are the seller's own photos of the item being priced:",
  });
  for (const photo of itemPhotos) content.push(imageBlock(photo));

  for (const candidate of candidates) {
    content.push({
      type: "text",
      text: `Candidate [${candidate.index}] — marketplace: ${candidate.marketplace}, title: ${candidate.title}. Its listing photo:`,
    });
    content.push(imageBlock(candidate.image));
  }

  content.push({
    type: "text",
    text: `For each candidate above, compare its listing photo to the seller's own photos and report:
- index: the candidate's own [N] number, exactly as given above.
- visualSimilarity: 0 to 1, how visually similar the candidate's photo is to the seller's item. Focus specifically on distinguishing visual details — graphics, prints, patterns, silhouette, wash/distressing, embroidery, logo placement, and other distinctive features — not just overall garment type and color. A candidate that matches on brand/category/color but shows a different graphic, pattern, or silhouette should score low. Never assume a match by default: if the candidate's photo is a stock/stylized image, shows the wrong angle, or doesn't clearly show enough detail to compare against the seller's photos, score low/uncertain rather than guessing high.
- rationale: a short (one sentence) note on what visually matched or mismatched, or null if there's nothing specific to note.

Return exactly ${candidates.length} judgments, one per candidate, each carrying its own index.`,
  });

  return content;
}

interface ParseResult {
  stop_reason: string | null;
  parsed_output: z.infer<typeof responseSchema> | null;
}

async function defaultParse(
  itemPhotos: ImageInput[],
  candidates: VisualMatchCandidateInput[],
  model: string,
): Promise<ParseResult> {
  // Same rationale as match-candidates.ts: a failed request should surface
  // as one billed attempt, not be silently retried by the SDK.
  const client = new Anthropic({ maxRetries: 0 });
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { format: zodOutputFormat(responseSchema) },
    messages: [{ role: "user", content: buildContent(itemPhotos, candidates) }],
  });
  return { stop_reason: response.stop_reason, parsed_output: response.parsed_output };
}

export interface MatchCandidatesVisualOptions {
  model?: string;
  /** Injectable for tests — production default calls the real Anthropic client. */
  parse?: (
    itemPhotos: ImageInput[],
    candidates: VisualMatchCandidateInput[],
    model: string,
  ) => Promise<ParseResult>;
}

/**
 * Stage 2: a bounded vision judgment call, run only on a small shortlist of
 * Stage 1 (match-candidates.ts) survivors that have a validated candidate
 * image (see providers/brave-discovery.ts for the shortlist/combination
 * logic). This is an enhancement layer, not a hard dependency — callers must
 * treat a thrown error here as recoverable and fall back to Stage 1's score
 * alone, never let a Stage 2 failure sink the whole research run.
 */
export async function matchCandidatesVisual(
  itemPhotos: ImageInput[],
  candidates: VisualMatchCandidateInput[],
  options: MatchCandidatesVisualOptions = {},
): Promise<VisualMatchJudgment[]> {
  if (candidates.length === 0) return [];

  const model = options.model ?? MODEL;
  const parse = options.parse ?? defaultParse;

  let result: ParseResult;
  try {
    result = await parse(itemPhotos, candidates, model);
  } catch (err) {
    throw new MarketResearchProviderError("The visual-matching request failed.", err);
  }

  if (result.stop_reason === "refusal") {
    throw new MarketResearchProviderError("The model declined to judge the candidate photos.");
  }
  if (result.parsed_output === null) {
    throw new MarketResearchProviderError("The model's response didn't match the expected format.");
  }
  if (result.parsed_output.judgments.length !== candidates.length) {
    throw new MarketResearchProviderError(
      `The model returned ${result.parsed_output.judgments.length} judgments for ${candidates.length} candidates.`,
    );
  }
  return result.parsed_output.judgments;
}
