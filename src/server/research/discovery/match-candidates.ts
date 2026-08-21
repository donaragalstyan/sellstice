import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { MarketResearchQuery } from "../provider";
import { COMPARABLE_PRICE_TYPES, MarketResearchProviderError } from "../provider";

// Independent of the old web_search provider's MARKET_RESEARCH_AI_MODEL —
// this call has no search tool and a different job (judgment, not
// discovery), so it gets its own env var rather than inheriting settings
// tuned for a different task.
const DEFAULT_MODEL = "claude-sonnet-5";
const MODEL = process.env.MARKET_RESEARCH_MATCH_AI_MODEL?.trim() || DEFAULT_MODEL;
// Sonnet 5 runs adaptive thinking by default even with no `thinking` param
// set, and those thinking tokens count against max_tokens. Empirically, a
// 49-candidate batch (discovery's fan-out — 5 marketplaces x 2 queries x 8
// results, before URL-shape filtering — can produce up to ~80) used ~4.4K
// output tokens (thinking + judgment JSON combined) against the old 4_000
// ceiling, truncating mid-response and breaking structured-output parsing.
// 16_000 gives real headroom for the worst case while staying under the
// SDK's streaming-required threshold for a single non-streaming call.
const MAX_TOKENS = 16_000;

export interface MatchCandidateInput {
  marketplace: string;
  title: string;
  snippet: string | null;
  /** Already verified by enrichComparables — shown for context only, the
   * matching step must never alter it. */
  priceCents: number | null;
}

export interface MatchJudgment {
  matchConfidence: number;
  priceType: (typeof COMPARABLE_PRICE_TYPES)[number];
  condition: string | null;
  recency: string | null;
}

const judgmentSchema = z.object({
  matchConfidence: z.number().min(0).max(1),
  priceType: z.enum(COMPARABLE_PRICE_TYPES),
  condition: z.string().nullable(),
  recency: z.string().nullable(),
});

const responseSchema = z.object({
  judgments: z.array(judgmentSchema),
});

function buildAttributesBlock(query: MarketResearchQuery): string {
  return [
    query.brand ? `Brand: ${query.brand}` : null,
    query.color ? `Color: ${query.color}` : null,
    query.category ? `Category: ${query.category}` : null,
    query.size ? `Size: ${query.size}` : null,
    query.condition ? `Condition: ${query.condition}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(query: MarketResearchQuery, candidates: MatchCandidateInput[]): string {
  const candidateBlock = candidates
    .map((c, i) => {
      const price = c.priceCents !== null ? `$${(c.priceCents / 100).toFixed(2)}` : "unknown";
      return `[${i}] marketplace: ${c.marketplace}\ntitle: ${c.title}\nsnippet: ${c.snippet ?? "(none)"}\nverified price: ${price}`;
    })
    .join("\n\n");

  return `You are judging whether each candidate resale listing below is genuinely comparable to a secondhand item with these confirmed attributes:

${buildAttributesBlock(query)}

These candidates were already retrieved by Sellstice's own search — do not search for anything else, just judge what's given below.

${candidateBlock}

For each candidate, in the same order, report:
- matchConfidence: 0 to 1, how well this specific listing matches the item's attributes above. A partial match (e.g. right brand but different category or color, or a vague/missing snippet) should get a low score, not be excluded. Missing or weak evidence must lower confidence — never treat an unclear candidate as a match by default.
- priceType: "SOLD" only if the title or snippet explicitly states this item sold or the listing is completed (e.g. "SOLD", a completed auction) — "ASKING" if it reads as a current active listing — "UNKNOWN" if you cannot tell. Never guess SOLD from an active listing's price alone.
- condition: the condition as described in the title/snippet, in the source's own words if possible, or null if not stated.
- recency: a short free-text description of how recent the listing/sale is if the title/snippet states one (e.g. "listed 3 days ago"), or null if not stated — do not invent a specific date you don't actually have.

Return exactly ${candidates.length} judgments, in the same order as the candidates above.`;
}

interface ParseResult {
  stop_reason: string | null;
  parsed_output: z.infer<typeof responseSchema> | null;
}

async function defaultParse(prompt: string, model: string): Promise<ParseResult> {
  // Same rationale as WebSearchComparableProvider: a failed request should
  // surface as one billed attempt, not be silently retried by the SDK.
  const client = new Anthropic({ maxRetries: 0 });
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { format: zodOutputFormat(responseSchema) },
    messages: [{ role: "user", content: prompt }],
  });
  return { stop_reason: response.stop_reason, parsed_output: response.parsed_output };
}

export interface MatchCandidatesOptions {
  model?: string;
  /** Injectable for tests — production default calls the real Anthropic client. */
  parse?: (prompt: string, model: string) => Promise<ParseResult>;
}

/**
 * The bounded, tool-free judgment step: Sellstice's own discovery and
 * enrichment already retrieved and price-verified every candidate here —
 * this call has no `tools` field at all and cannot search for anything
 * else. Single request over the whole batch (one billed attempt, no
 * retries), never per-candidate resilient: a total failure here means no
 * reliable signal on any candidate, which is a real failure worth
 * propagating, not silently returning partial/guessed judgments for.
 */
export async function matchCandidates(
  query: MarketResearchQuery,
  candidates: MatchCandidateInput[],
  options: MatchCandidatesOptions = {},
): Promise<MatchJudgment[]> {
  if (candidates.length === 0) return [];

  const model = options.model ?? MODEL;
  const parse = options.parse ?? defaultParse;
  const prompt = buildPrompt(query, candidates);

  let result: ParseResult;
  try {
    result = await parse(prompt, model);
  } catch (err) {
    throw new MarketResearchProviderError("The comparable-matching request failed.", err);
  }

  if (result.stop_reason === "refusal") {
    throw new MarketResearchProviderError("The model declined to judge the candidates.");
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
