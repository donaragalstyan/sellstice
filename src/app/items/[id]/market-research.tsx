import type { ComparableListing } from "@/generated/prisma/client";
import { formatCents, formatConfidence } from "@/lib/format";
import {
  assessComparableQuality,
  classifyComparableTier,
  hasEnoughAttributesToResearch,
  type ComparableTier,
} from "@/server/research/comparables";
import { MarketResearchButton } from "./market-research-button";
import { RefineComparablesButton } from "./refine-comparables-button";
import { ManualComparableForm } from "./manual-comparable-form";
import { DeleteComparableButton } from "./delete-comparable-button";

const PRICE_TYPE_BADGE: Record<string, string> = {
  ASKING: "Asking",
  SOLD: "Sold",
  UNKNOWN: "Price unknown",
};

const SOURCE_BADGE: Record<string, string> = {
  WEB_SEARCH: "Web",
  MANUAL: "Manual",
};

const TIER_BADGE: Record<ComparableTier, { text: string; className: string }> = {
  NEAR_IDENTICAL: { text: "Near-identical", className: "text-green-800 dark:text-green-300 font-medium" },
  GOOD: { text: "Good match", className: "text-green-700 dark:text-green-400" },
  APPROXIMATE: { text: "Approximate match", className: "text-amber-700 dark:text-amber-400" },
  WEAK: { text: "Weak match", className: "text-gray-500 dark:text-gray-400" },
};

// Short label for how a price was (or wasn't) verified — priceEvidenceDetail
// (Phase 10.4), when present, goes in the label's `title` so the specific
// reason is a hover away without cluttering the row.
const PRICE_EVIDENCE_BADGE: Record<string, { text: string; className: string }> = {
  STRUCTURED_DATA: { text: "Verified", className: "text-green-700 dark:text-green-400" },
  META_TAG: { text: "Verified", className: "text-green-700 dark:text-green-400" },
  MICRODATA: { text: "Verified", className: "text-green-700 dark:text-green-400" },
  UNVERIFIED: { text: "Unverified", className: "text-gray-500 dark:text-gray-400" },
  BLOCKED: { text: "Blocked", className: "text-gray-500 dark:text-gray-400" },
};

export function MarketResearch({
  itemId,
  item,
  comparables,
}: {
  itemId: string;
  item: { brand: string | null; category: string | null };
  comparables: ComparableListing[];
}) {
  const quality = assessComparableQuality(comparables);
  const canResearch = hasEnoughAttributesToResearch({
    brand: item.brand,
    color: null,
    category: item.category,
    size: null,
    condition: null,
    notableDetails: null,
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-gray-600">Market research</h2>

      <MarketResearchButton
        itemId={itemId}
        disabled={!canResearch}
        disabledReason="Add a brand or category first so there's something to search for."
      />

      {comparables.length > 0 && (
        <p
          className={`text-sm ${quality.sufficient ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}
        >
          {quality.sufficient
            ? quality.reason
            : `Not enough reliable comps yet. ${quality.reason}`}
        </p>
      )}

      {comparables.length > 0 && !quality.sufficient && <RefineComparablesButton itemId={itemId} />}

      {comparables.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comparables.map((c) => {
            const confidenceLabel = formatConfidence(c.matchConfidence);
            const tierBadge = TIER_BADGE[classifyComparableTier(c)];
            const visualBadge =
              c.visualSimilarity === null
                ? null
                : c.visualSimilarity >= 0.5
                  ? { text: "Visually confirmed", className: "text-green-700 dark:text-green-400" }
                  : { text: "Visual mismatch", className: "text-amber-700 dark:text-amber-400" };
            return (
              <li
                key={c.id}
                className="flex flex-col gap-1 rounded-md border border-gray-300 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {c.title}
                      </a>
                    ) : (
                      c.title
                    )}
                  </span>
                  <DeleteComparableButton itemId={itemId} comparableId={c.id} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-white/10">
                    {SOURCE_BADGE[c.source] ?? c.source}
                  </span>
                  {c.marketplace && <span>{c.marketplace}</span>}
                  <span title={c.priceEvidenceDetail ?? undefined}>
                    {c.priceCents !== null
                      ? `${formatCents(c.priceCents)} · ${PRICE_TYPE_BADGE[c.priceType] ?? c.priceType}`
                      : "Price unknown"}
                  </span>
                  {c.priceEvidence && (
                    <span
                      className={PRICE_EVIDENCE_BADGE[c.priceEvidence]?.className}
                      title={c.priceEvidenceDetail ?? undefined}
                    >
                      {PRICE_EVIDENCE_BADGE[c.priceEvidence]?.text ?? c.priceEvidence}
                    </span>
                  )}
                  {c.condition && <span>Condition: {c.condition}</span>}
                  {c.recency && <span>{c.recency}</span>}
                  <span className={tierBadge.className}>{tierBadge.text}</span>
                  {confidenceLabel && <span>{confidenceLabel}</span>}
                  {visualBadge && <span className={visualBadge.className}>{visualBadge.text}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ManualComparableForm itemId={itemId} />
    </section>
  );
}
