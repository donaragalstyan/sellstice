import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type {
  MarketResearchProvider,
  MarketResearchQuery,
  ComparableSearchResult,
} from "../provider";
import { comparableSearchResultSchema, MarketResearchProviderError } from "../provider";

// Unlike item analysis / photo coach, this task benefits from stronger
// reasoning — constructing good search queries, judging real-world
// comparability, and correctly distinguishing asking vs. sold prices — so
// the default is Sonnet-tier rather than Haiku. Sonnet 5 is also explicitly
// documented as supporting the dynamic-filtering web_search tool variant
// used below; Haiku's support for it isn't confirmed, and guessing wrong
// here means a wasted request (as happened with `effort` in Phase 3).
const DEFAULT_MODEL = "claude-sonnet-5";
const MODEL = process.env.MARKET_RESEARCH_AI_MODEL?.trim() || DEFAULT_MODEL;
const MAX_TOKENS = 4096;
const MAX_SEARCH_USES = 5;

const responseSchema = z.object({
  comparables: z.array(comparableSearchResultSchema),
});

function buildInstructions(query: MarketResearchQuery): string {
  const attributes = [
    query.brand ? `Brand: ${query.brand}` : null,
    query.color ? `Color: ${query.color}` : null,
    query.category ? `Category: ${query.category}` : null,
    query.size ? `Size: ${query.size}` : null,
    query.condition ? `Condition: ${query.condition}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are researching comparable resale listings for a secondhand item with these confirmed attributes:

${attributes}

Use web search to find real, currently-listed or recently-sold items on public resale/secondhand marketplaces (eBay, Poshmark, Depop, Mercari, Vinted, Grailed, ThredUp, or similar) that are genuinely comparable — same or very similar brand, category, and condition. Do not restrict yourself to one marketplace.

For each comparable you find, report:
- title: the listing's title as shown on the source
- marketplace: which site it's from (e.g. "eBay", "Poshmark"), or null if unclear
- priceCents: the price in cents, or null if you can't determine a real number
- priceType: "SOLD" only if the source explicitly states this item sold or the listing is completed/sold (e.g. an eBay "Sold" listing showing a final sale price) — "ASKING" if it's a current active listing's asking price — "UNKNOWN" if you cannot tell. Never guess SOLD from an active listing's asking price.
- url: the actual URL of the listing from your search results — never invent one
- condition: the condition as described in that listing, in the seller's own words if possible, or null if not stated
- recency: a short free-text description of how recent the listing/sale is if the source states one (e.g. "listed 3 days ago", "sold last month"), or null if not stated — do not invent a specific date you don't actually have
- confidence: 0 to 1, how well this specific listing actually matches the item's attributes above. A partial match (e.g. right brand but different category, or condition not stated) should get a low score, not be excluded.

Only include listings you actually found via search — never fabricate a listing, price, or URL. It is expected and fine to return fewer results if genuinely comparable listings are hard to find; do not pad the list with weak matches just to reach a target count.`;
}

export class WebSearchComparableProvider implements MarketResearchProvider {
  readonly name = "web_search";
  private client: Anthropic;

  constructor(private readonly model: string = MODEL) {
    // Same rationale as AnthropicProvider (src/server/ai/providers/anthropic.ts):
    // a failed request should surface as one billed attempt, not be silently
    // retried by the SDK.
    this.client = new Anthropic({ maxRetries: 0 });
  }

  async findComparables(query: MarketResearchQuery): Promise<ComparableSearchResult[]> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: MAX_TOKENS,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCH_USES }],
        output_config: {
          format: zodOutputFormat(responseSchema),
        },
        messages: [{ role: "user", content: buildInstructions(query) }],
      });
    } catch (err) {
      throw new MarketResearchProviderError("The market research request failed.", err);
    }

    if (response.stop_reason === "refusal") {
      throw new MarketResearchProviderError("The model declined to research comparables.");
    }
    if (response.parsed_output === null) {
      throw new MarketResearchProviderError(
        "The model's response didn't match the expected format.",
      );
    }
    return response.parsed_output.comparables;
  }
}
