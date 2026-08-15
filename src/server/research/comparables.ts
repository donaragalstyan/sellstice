import { WebSearchComparableProvider } from "./providers/web-search";
import { getCooldownRemainingMs } from "@/server/ai/cooldown";
import type { ComparableSearchResult, MarketResearchQuery } from "./provider";

const provider = new WebSearchComparableProvider();

export async function findComparableListings(
  query: MarketResearchQuery,
): Promise<ComparableSearchResult[]> {
  return provider.findComparables(query);
}

/**
 * Research is a heavier operation (a web search, not a bounded extraction),
 * so its cooldown is longer than item analysis / photo coach's 30s. Same
 * rationale otherwise: server-side backstop against double-clicks, extra
 * tabs, or a direct call to the server action.
 */
export const MARKET_RESEARCH_COOLDOWN_MS = 60_000;

export function getMarketResearchCooldownRemainingMs(
  lastRunAt: Date | null,
  now: Date,
  cooldownMs = MARKET_RESEARCH_COOLDOWN_MS,
): number {
  return getCooldownRemainingMs(lastRunAt, now, cooldownMs);
}

/** Don't spend a research call on an item with nothing to search for. */
export function hasEnoughAttributesToResearch(query: MarketResearchQuery): boolean {
  return Boolean(query.brand || query.category);
}

// --- Deduplication -----------------------------------------------------

interface ComparableKeyFields {
  url: string | null;
  title: string;
  marketplace: string | null;
  priceCents: number | null;
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two comps are "obviously" the same listing if they share a URL, or —
 * lacking one — the same normalized title, marketplace, and price. */
function comparableKey(comp: ComparableKeyFields): string {
  return comp.url
    ? `url:${normalizeUrlKey(comp.url)}`
    : `sig:${normalizeTitleKey(comp.title)}|${(comp.marketplace ?? "").toLowerCase()}|${comp.priceCents ?? "null"}`;
}

/** Dedupes within a single batch, keeping the first occurrence of each. */
export function deduplicateComparables<T extends ComparableKeyFields>(comps: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const comp of comps) {
    const key = comparableKey(comp);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(comp);
  }
  return result;
}

/**
 * Filters `incoming` down to comps not already present in `existing`, so
 * re-running research on an item accumulates genuinely new listings instead
 * of re-inserting the same real-world result every time.
 */
export function deduplicateAgainstExisting<T extends ComparableKeyFields>(
  existing: ComparableKeyFields[],
  incoming: T[],
): T[] {
  const seen = new Set(existing.map(comparableKey));
  const result: T[] = [];
  for (const comp of incoming) {
    const key = comparableKey(comp);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(comp);
  }
  return result;
}

// --- Quality thresholds --------------------------------------------------

export const MIN_COMPARABLE_CONFIDENCE = 0.5;
export const MIN_USABLE_COMPARABLES = 3;

export interface ComparableQualityAssessment {
  usableCount: number;
  totalCount: number;
  sufficient: boolean;
  reason: string;
}

/** The only priceEvidence values that back a price with something we can actually point to. */
const TRUSTED_PRICE_EVIDENCE = new Set<string>(["STRUCTURED_DATA", "META_TAG", "MICRODATA"]);

interface QualityFields {
  source: "WEB_SEARCH" | "MANUAL";
  priceCents: number | null;
  matchConfidence: number | null;
  priceEvidence: string | null;
}

/**
 * An automated comp only counts toward the trustworthy set if it has a real,
 * verified price (priceEvidence backed by something deterministic — see
 * enrichment/enrich-comparables.ts and ComparablePriceEvidence's doc comment
 * in the Prisma schema, not just a non-null priceCents) and a match
 * confidence that clears the bar. A manual comp has no match confidence or
 * priceEvidence by design (there's nothing to estimate or verify — the user
 * is vouching for it directly), so it's gated on price alone: requiring an
 * AI confidence value or automated evidence from a user-entered row would
 * make manual entry unable to ever satisfy the threshold, defeating its
 * purpose as a real override when automated research comes up short.
 */
export function isUsableComparable(comp: QualityFields): boolean {
  if (comp.priceCents === null) return false;
  if (comp.source === "MANUAL") return true;
  if (!comp.priceEvidence || !TRUSTED_PRICE_EVIDENCE.has(comp.priceEvidence)) return false;
  return comp.matchConfidence !== null && comp.matchConfidence >= MIN_COMPARABLE_CONFIDENCE;
}

/**
 * The deterministic gate behind "say 'not enough reliable comps' rather than
 * confidently recommend a bad price" — computed fresh over whatever comps
 * currently exist for an item (not cached), so it can't go stale as comps
 * are added or removed.
 */
export function assessComparableQuality(comps: QualityFields[]): ComparableQualityAssessment {
  const usableCount = comps.filter(isUsableComparable).length;
  const sufficient = usableCount >= MIN_USABLE_COMPARABLES;
  return {
    usableCount,
    totalCount: comps.length,
    sufficient,
    reason: sufficient
      ? `${usableCount} reliable comparable${usableCount === 1 ? "" : "s"} found.`
      : `Only ${usableCount} reliable comparable${usableCount === 1 ? "" : "s"} out of ${comps.length} found (need at least ${MIN_USABLE_COMPARABLES}). Treat any pricing guidance as low-confidence until more comps are available.`,
  };
}

// --- Normalization ---------------------------------------------------------

export function mapComparablesToCreateData(itemId: string, results: ComparableSearchResult[]) {
  return results.map((r) => ({
    itemId,
    source: "WEB_SEARCH" as const,
    title: r.title,
    marketplace: r.marketplace,
    priceCents: r.priceCents,
    priceType: r.priceType,
    url: r.url,
    condition: r.condition,
    recency: r.recency,
    matchConfidence: r.matchConfidence,
    priceEvidence: r.priceEvidence,
    rawMetadata: r,
  }));
}
