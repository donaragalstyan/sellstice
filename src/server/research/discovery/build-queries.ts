import type { MarketResearchQuery } from "../provider";

/**
 * Fixed structural bound on query fan-out, not env-tunable — this caps the
 * Brave adapter's per-marketplace request count by construction (see
 * providers/brave.ts), so raising it is a deliberate code change, not a
 * config knob that could silently blow the discovery request budget.
 */
export const MAX_QUERIES_PER_MARKETPLACE = 2;

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function joinNonNull(values: (string | null)[]): string | null {
  const parts = values.map(clean).filter((v): v is string => v !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

// Bounds how much of the free-text notableDetails field (up to 2000 chars,
// see lib/validation.ts) can enter a search query — long enough to carry a
// real distinguishing phrase, short enough not to drown out brand/category.
const MAX_DISTINCTIVE_SNIPPET_CHARS = 60;

/**
 * Pulls a short, search-friendly fragment out of the item's notableDetails
 * field: the first sentence/clause, bounded in length. Deliberately naive
 * (no AI call) — this is meant to catch the common case of a user leading
 * with the item's most distinctive feature (e.g. "Distinctive tiger graphic
 * on front, otherwise good condition"), not to summarize arbitrary text.
 */
function extractDistinctiveSnippet(notableDetails: string | null): string | null {
  const trimmed = clean(notableDetails);
  if (trimmed === null) return null;
  const firstClause = trimmed.split(/[.\n!?]/)[0]?.trim();
  if (!firstClause) return null;
  return firstClause.length > MAX_DISTINCTIVE_SNIPPET_CHARS
    ? firstClause.slice(0, MAX_DISTINCTIVE_SNIPPET_CHARS).trim()
    : firstClause;
}

/**
 * Turns an item's confirmed attributes into a small, fixed-size set of
 * plain search strings. Pure and deterministic — no I/O, no query ever
 * built from a previous query's results (no recursion/expansion). One
 * precise query (brand+color+category+a distinctive detail, when present)
 * and one looser fallback (brand+category only, deliberately dropping both
 * color and the distinctive detail) when they'd actually differ — mirrors
 * the pilot's single-query approach while leaving room for a query that's
 * too narrow to still find something via the looser one. Marketplace-
 * agnostic: the `site:` domain restriction is the Brave adapter's concern,
 * not this function's, so the same list could later feed a keyword search
 * with no `site:` concept at all (e.g. eBay).
 */
export function buildSearchQueries(query: MarketResearchQuery): string[] {
  const distinctive = extractDistinctiveSnippet(query.notableDetails);
  const precise = joinNonNull([query.brand, query.color, query.category, distinctive]);
  const loose = joinNonNull([query.brand, query.category]);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of [precise, loose]) {
    if (candidate === null) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length >= MAX_QUERIES_PER_MARKETPLACE) break;
  }
  return result;
}
