import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { formatCents } from "@/lib/format";
import { ITEM_CONDITION_LABELS } from "@/lib/item-display";
import { assessComparableQuality, type ComparableTier, type QualityFields } from "@/server/research/comparables";
import {
  computePriceRecommendation,
  type PriceRecommendation,
  type PriceRecommendationInput,
} from "@/server/research/price-recommendation";
import { getCooldownRemainingMs } from "./cooldown";

// This is a genuine judgment call — weighing several independently-computed
// signals into a stance, not bounded extraction — so it gets the same model
// class as Stage 1 comp matching (match-candidates.ts) rather than the
// Haiku default used for pure vision extraction (item-analysis.ts).
const DEFAULT_MODEL = "claude-sonnet-5";
const MODEL = process.env.SELL_TIMING_AI_MODEL?.trim() || DEFAULT_MODEL;
const MODEL_ID = `anthropic:${MODEL}`;

// Sonnet 5 runs adaptive thinking by default even with no `thinking` param
// set, and those thinking tokens count against max_tokens — the same failure
// mode documented in match-candidates.ts (a 4,000 ceiling truncated mid-
// response on that call). This is a single small verdict object rather than
// a per-candidate batch, so it doesn't need that call's 16,000, but still
// gets a generous ceiling rather than an extraction-sized default.
const MAX_TOKENS = 4_000;

/**
 * Cheap relative to a research run (no web search, no vision) — closer in
 * cost/latency to item analysis than to market research, so it gets the same
 * cooldown duration as ANALYSIS_COOLDOWN_MS (item-analysis.ts) rather than
 * MARKET_RESEARCH_COOLDOWN_MS's 60s.
 */
export const SELL_TIMING_COOLDOWN_MS = 30_000;

export function getSellTimingCooldownRemainingMs(
  lastRunAt: Date | null,
  now: Date,
  cooldownMs = SELL_TIMING_COOLDOWN_MS,
): number {
  return getCooldownRemainingMs(lastRunAt, now, cooldownMs);
}

export class SellTimingProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SellTimingProviderError";
  }
}

// --- Signal aggregation (deterministic, no AI call) -------------------------

export interface ComparableSignal {
  totalCount: number;
  usableCount: number;
  tierCounts: Record<ComparableTier, number>;
  distinctMarketplaceCount: number;
  soldCount: number;
  askingCount: number;
  priceRecommendation: PriceRecommendation | null;
}

export interface ComparableSignalInput extends QualityFields, PriceRecommendationInput {
  marketplace: string | null;
  priceType: string;
}

/** Everything the discovery/matching/price-recommendation pipeline already
 * computes, reduced to what a sell-timing judgment needs — no new AI call. */
export function summarizeComparablesForSellTiming(comps: ComparableSignalInput[]): ComparableSignal {
  const quality = assessComparableQuality(comps);
  const priceRecommendation = computePriceRecommendation(comps);
  const distinctMarketplaceCount = new Set(
    comps.map((c) => c.marketplace).filter((m): m is string => m !== null),
  ).size;
  const soldCount = comps.filter((c) => c.priceType === "SOLD").length;
  const askingCount = comps.filter((c) => c.priceType === "ASKING").length;

  return {
    totalCount: quality.totalCount,
    usableCount: quality.usableCount,
    tierCounts: quality.tierCounts,
    distinctMarketplaceCount,
    soldCount,
    askingCount,
    priceRecommendation,
  };
}

export interface GoalSignal {
  targetAmountCents: number;
  daysRemaining: number;
  deadlinePassed: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** revenueEarnedCents isn't tracked anywhere yet (see goal.service.ts's own
 * dashboard call site), so this deliberately doesn't compute a pace status
 * (AHEAD/ON_TRACK/BEHIND) — that would present a number derived from a known-
 * fake zero as if it meant something. Only the deadline itself, which is
 * real, becomes a signal. */
export function buildGoalSignal(goal: { targetAmountCents: number; deadline: Date } | null, now: Date): GoalSignal | null {
  if (!goal) return null;
  const daysRemaining = Math.ceil((goal.deadline.getTime() - now.getTime()) / MS_PER_DAY);
  return {
    targetAmountCents: goal.targetAmountCents,
    daysRemaining: Math.max(0, daysRemaining),
    deadlinePassed: daysRemaining <= 0,
  };
}

export interface SellTimingSignals {
  brand: string | null;
  category: string | null;
  condition: string | null;
  comparables: ComparableSignal;
  goal: GoalSignal | null;
  now: Date;
}

// --- Prompt construction -----------------------------------------------------

function formatConditionLabel(condition: string | null): string {
  if (!condition) return "not specified";
  return ITEM_CONDITION_LABELS[condition] ?? condition;
}

function buildComparablesBlock(c: ComparableSignal): string {
  const lines = [
    `${c.totalCount} comparable listing${c.totalCount === 1 ? "" : "s"} found across ${c.distinctMarketplaceCount} marketplace${c.distinctMarketplaceCount === 1 ? "" : "s"} — treat marketplace count as a rough supply signal.`,
    `Match quality breakdown: ${c.tierCounts.NEAR_IDENTICAL} near-identical, ${c.tierCounts.GOOD} good, ${c.tierCounts.APPROXIMATE} approximate, ${c.tierCounts.WEAK} weak.`,
    `Among these, ${c.soldCount} are confirmed sold and ${c.askingCount} are still actively asking — a higher sold share suggests items like this move faster (a demand proxy, not a guarantee).`,
  ];
  if (c.priceRecommendation) {
    const p = c.priceRecommendation;
    lines.push(
      `Price signal (${p.confidence.toLowerCase()} confidence): comparable prices range ${formatCents(p.comparablePriceRangeLowCents)}-${formatCents(p.comparablePriceRangeHighCents)}, median ${formatCents(p.medianComparablePriceCents)}, Sellstice's recommended listing price ${formatCents(p.recommendedListingPriceCents)}.`,
    );
  } else {
    lines.push("No usable price signal yet — no comparable has both a real match and a verified price.");
  }
  return lines.join("\n");
}

function buildGoalBlock(goal: GoalSignal | null): string {
  if (!goal) return "The seller has no active financial goal or deadline set.";
  if (goal.deadlinePassed) {
    return `The seller's goal deadline (target ${formatCents(goal.targetAmountCents)}) has already passed.`;
  }
  return `The seller has ${goal.daysRemaining} day${goal.daysRemaining === 1 ? "" : "s"} left toward a ${formatCents(goal.targetAmountCents)} goal.`;
}

function buildPrompt(signals: SellTimingSignals): string {
  const todayLabel = signals.now.toISOString().slice(0, 10);
  const monthLabel = signals.now.toLocaleString("en-US", { month: "long" });

  return `You are advising a secondhand-item seller on whether to sell this item now or wait for a better opportunity.

Item: ${signals.brand ?? "unknown brand"}, ${signals.category ?? "unknown category"}, condition: ${formatConditionLabel(signals.condition)}.
Today's date: ${todayLabel}.

${buildComparablesBlock(signals.comparables)}

${buildGoalBlock(signals.goal)}

Weigh all of this together — including your own general knowledge of how this brand/category typically holds resale value, and whether ${monthLabel} is a strong or weak selling season for this kind of item. Only the figures given above are real; do not invent specific market numbers, sale counts, or prices you weren't given.

Decide:
- stance: "SELL_NOW" if the evidence favors listing/selling promptly, "WAIT" if it favors holding for a better price or moment.
- confidence: 0 to 1, how confident you are in this stance given the signals above. Lower confidence when comp data is sparse or the signals conflict with each other.
- explanation: 2-4 sentences in plain English, citing the specific factors above that drove the decision — not generic advice.`;
}

// --- AI call ------------------------------------------------------------

const sellTimingResponseSchema = z.object({
  stance: z.enum(["SELL_NOW", "WAIT"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
});

export type SellTimingJudgment = z.infer<typeof sellTimingResponseSchema>;

interface ParseResult {
  stop_reason: string | null;
  parsed_output: SellTimingJudgment | null;
}

async function defaultParse(prompt: string, model: string): Promise<ParseResult> {
  // Same rationale as match-candidates.ts: a failed request should surface
  // as one billed attempt, not be silently retried by the SDK.
  const client = new Anthropic({ maxRetries: 0 });
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    // "medium" effort: a bounded judgment task, not open-ended reasoning —
    // see match-candidates.ts for the measurement behind this choice.
    output_config: { format: zodOutputFormat(sellTimingResponseSchema), effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  });
  return { stop_reason: response.stop_reason, parsed_output: response.parsed_output };
}

export interface AssessSellTimingOptions {
  model?: string;
  /** Injectable for tests — production default calls the real Anthropic client. */
  parse?: (prompt: string, model: string) => Promise<ParseResult>;
}

/**
 * The bounded, single-call judgment behind "sell now vs. wait" (Phase 10.6):
 * every signal is already computed by Sellstice's own code (comps, pricing,
 * goal timeline) — this call has no tools and cannot look anything up itself.
 * Not a retry-style agent: there's no natural "try again differently" move
 * for a synthesis task like this the way there is for weak research results.
 */
export async function assessSellTiming(
  signals: SellTimingSignals,
  options: AssessSellTimingOptions = {},
): Promise<SellTimingJudgment> {
  const model = options.model ?? MODEL;
  const parse = options.parse ?? defaultParse;
  const prompt = buildPrompt(signals);

  let result: ParseResult;
  try {
    result = await parse(prompt, model);
  } catch (err) {
    throw new SellTimingProviderError("The sell-timing request failed.", err);
  }

  if (result.stop_reason === "refusal") {
    throw new SellTimingProviderError("The model declined to give a sell-timing recommendation.");
  }
  if (result.parsed_output === null) {
    throw new SellTimingProviderError("The model's response didn't match the expected format.");
  }
  return result.parsed_output;
}

export function mapSellTimingToCreateData(itemId: string, result: SellTimingJudgment) {
  return {
    itemId,
    stance: result.stance,
    confidence: result.confidence,
    explanation: result.explanation,
    modelId: MODEL_ID,
  };
}
