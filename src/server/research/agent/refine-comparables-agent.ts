import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ImageInput } from "@/server/ai";
import { assessComparableQuality, type QualityFields } from "../comparables";
import type { ComparableSearchResult, MarketResearchQuery } from "../provider";

// Real reasoning task (judging which alternate search strategy is worth
// trying), not bounded extraction — same model tier as the Stage 1/Stage 2
// matching calls (discovery/match-candidates.ts, discovery/match-candidates-visual.ts).
const DEFAULT_MODEL = "claude-sonnet-5";
const MODEL = process.env.MARKET_RESEARCH_REFINEMENT_AI_MODEL?.trim() || DEFAULT_MODEL;
// Small tool-result payloads per turn, but Sonnet 5 runs adaptive thinking by
// default and those tokens count against max_tokens (see the Stage 1
// MAX_TOKENS fix in match-candidates.ts) — kept generous rather than tight.
const MAX_TOKENS = 8_000;
// A hard fallback on total API round-trips, independent of the retry budget
// below (which counts actual pipeline re-runs, not conversation turns) — a
// harness-level backstop against a runaway loop, not something the model
// can talk its way past.
const MAX_ITERATIONS = 8;

/** Real, harness-enforced budget on pipeline re-runs — not just a prompt instruction. */
export const MAX_REFINEMENT_RETRIES = 2;

export interface RefinementOutcome {
  decision: "sufficient" | "insufficient";
  summary: string;
  iterationsUsed: number;
}

export interface RefinementAgentDeps {
  originalQuery: MarketResearchQuery;
  itemPhotos: ImageInput[];
  /** Everything already known for this item before refinement starts. */
  baselineComps: QualityFields[];
  /** Re-runs the full discovery+enrich+match(+visual) pipeline for a (possibly modified) query — same shape as comparables.ts's findComparableListings. */
  runResearch: (query: MarketResearchQuery, itemPhotos: ImageInput[]) => Promise<ComparableSearchResult[]>;
  /**
   * Dedupes newResults against everything accumulated so far, persists them,
   * and returns the FULL updated cumulative comp set for tier re-assessment.
   * In production this writes a new ComparableResearchRun + ComparableListing
   * rows (see market-research-actions.ts); tests can inject an in-memory fake.
   */
  persistIteration: (query: MarketResearchQuery, newResults: ComparableSearchResult[]) => Promise<QualityFields[]>;
}

interface RetryBudget {
  remaining: number;
}

interface SessionState {
  cumulativeComps: QualityFields[];
  outcome: RefinementOutcome | null;
}

function reasoningField() {
  return z.string().describe("Why this alternate strategy might surface better matches than what's already been tried");
}

async function executeRetry(
  deps: RefinementAgentDeps,
  budget: RetryBudget,
  state: SessionState,
  overrides: Partial<MarketResearchQuery>,
): Promise<string> {
  if (budget.remaining <= 0) {
    return JSON.stringify({
      error: "No retries remaining for this session. Call report_final_outcome now.",
    });
  }
  budget.remaining -= 1;

  const modifiedQuery: MarketResearchQuery = { ...deps.originalQuery, ...overrides };
  const raw = await deps.runResearch(modifiedQuery, deps.itemPhotos);
  const updatedCumulative = await deps.persistIteration(modifiedQuery, raw);
  state.cumulativeComps = updatedCumulative;

  const quality = assessComparableQuality(updatedCumulative);
  return JSON.stringify({
    newCandidatesFound: raw.length,
    tierCounts: quality.tierCounts,
    sufficientNow: quality.sufficient,
    retriesRemaining: budget.remaining,
  });
}

/**
 * Builds the four tools the refinement agent can call. Each tool's `run` is
 * a plain async function closing over `budget`/`state` — this is what makes
 * the tool logic directly unit-testable (call `.run(input)` yourself) without
 * mocking the Anthropic client or the tool-calling protocol at all.
 */
export function buildRefinementTools(deps: RefinementAgentDeps, budget: RetryBudget, state: SessionState) {
  const retryCategory = betaZodTool({
    name: "retry_with_category_variant",
    description:
      "Re-run comparable discovery using an alternate or broader category term (e.g. 'Hoodie' -> 'Sweatshirt'), keeping brand/color/condition/size unchanged. Call this when the current category term may be too narrow or non-standard for how listings are actually titled.",
    inputSchema: z.object({
      category: z.string().describe("The alternate category term to search with"),
      reasoning: reasoningField(),
    }),
    run: async (input) => executeRetry(deps, budget, state, { category: input.category }),
  });

  const retryBrand = betaZodTool({
    name: "retry_with_brand_variant",
    description:
      "Re-run comparable discovery using an alternate brand term or spelling (e.g. 'Ralph Lauren' -> 'Polo Ralph Lauren' or 'Lauren Ralph Lauren'), keeping color/category/condition/size unchanged. Call this when the current brand term may not match how sellers actually list this item.",
    inputSchema: z.object({
      brand: z.string().describe("The alternate brand term to search with"),
      reasoning: reasoningField(),
    }),
    run: async (input) => executeRetry(deps, budget, state, { brand: input.brand }),
  });

  const retryWithoutDetail = betaZodTool({
    name: "retry_without_notable_detail",
    description:
      "Re-run comparable discovery with the distinctive-detail search term removed, keeping brand/color/category/condition/size unchanged. Call this when the distinctive detail phrase may be too narrow or unusual and could be suppressing otherwise-good matches.",
    inputSchema: z.object({
      reasoning: reasoningField(),
    }),
    run: async () => executeRetry(deps, budget, state, { notableDetails: null }),
  });

  const reportFinalOutcome = betaZodTool({
    name: "report_final_outcome",
    description:
      "Call this to end the refinement session once you've either found enough reliable comparables or exhausted reasonable retry strategies. This is the only way to conclude a session — always call it eventually, even if no retry helped.",
    inputSchema: z.object({
      decision: z.enum(["sufficient", "insufficient"]),
      summary: z.string().describe("A short, user-facing summary of what was tried and the outcome"),
    }),
    run: async (input) => {
      state.outcome = { decision: input.decision, summary: input.summary, iterationsUsed: 0 };
      return JSON.stringify({ acknowledged: true });
    },
  });

  return [retryCategory, retryBrand, retryWithoutDetail, reportFinalOutcome];
}

function buildInitialPrompt(deps: RefinementAgentDeps, tierCounts: ReturnType<typeof assessComparableQuality>["tierCounts"]): string {
  return `A market-research run for a resale item came back without enough reliable comparables. Your job is to decide whether an alternate search strategy is worth trying, using the tools available — and to conclude by calling report_final_outcome once you've either found enough or exhausted reasonable strategies.

Item attributes:
${JSON.stringify(deps.originalQuery, null, 2)}

Current comparable counts by tier: ${JSON.stringify(tierCounts)}
At least 3 comps at the GOOD or NEAR_IDENTICAL tier are needed to be "sufficient".

You have ${MAX_REFINEMENT_RETRIES} retries available. Each retry re-runs the full discovery pipeline with one thing changed, which costs real time and money — only call a retry tool when you have a genuine, specific reason to think it will help, not as a default action. If nothing about the current attributes looks fixable, call report_final_outcome with "insufficient" rather than guessing at changes with no real rationale.`;
}

/**
 * Runs the refinement session: a bounded, tool-calling agent loop (Anthropic's
 * real tool-use protocol via the Tool Runner — not a hand-rolled loop around
 * a single structured-output call) that decides which alternate search
 * strategy is worth trying, executes it via the injected deps, and observes
 * the result before deciding whether to try again or conclude.
 */
export async function runRefinementAgent(deps: RefinementAgentDeps): Promise<RefinementOutcome> {
  const budget: RetryBudget = { remaining: MAX_REFINEMENT_RETRIES };
  const state: SessionState = { cumulativeComps: deps.baselineComps, outcome: null };
  const tools = buildRefinementTools(deps, budget, state);
  const baselineQuality = assessComparableQuality(deps.baselineComps);

  const client = new Anthropic({ maxRetries: 0 });
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    max_iterations: MAX_ITERATIONS,
    // "medium" effort — deciding between a small set of retry strategies is
    // a bounded task, not open-ended reasoning; same rationale as the
    // Stage 1/Stage 2 matching calls.
    output_config: { effort: "medium" },
    // Top-level auto-caching: the tool definitions + initial prompt are
    // identical across every turn of this loop (only the trailing
    // tool_result differs), so this can cut real cost on retry turns 2+.
    // No downside if the prefix falls under the ~1024-token cache minimum —
    // it just silently doesn't cache.
    cache_control: { type: "ephemeral" },
    tools,
    messages: [{ role: "user", content: buildInitialPrompt(deps, baselineQuality.tierCounts) }],
  });

  try {
    await runner;
  } catch {
    // A total session failure (network error, refusal) is not fatal to the
    // caller — refinement is an enhancement on top of the original research
    // run, which already succeeded. Fall through to the same "no outcome
    // reported" fallback used when the agent simply stops without concluding.
  }

  const iterationsUsed = MAX_REFINEMENT_RETRIES - budget.remaining;
  if (state.outcome) {
    return { ...state.outcome, iterationsUsed };
  }
  // Claude stopped (hit max_iterations, or ended the turn) without ever
  // calling report_final_outcome — treat as insufficient rather than
  // leaving the caller with nothing.
  return {
    decision: "insufficient",
    summary: "The refinement agent stopped without reporting a final outcome.",
    iterationsUsed,
  };
}
