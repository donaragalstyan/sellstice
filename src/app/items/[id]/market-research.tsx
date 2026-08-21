import type { ComparableListing } from "@/generated/prisma/client";
import { formatCents, formatConfidence } from "@/lib/format";
import { assessComparableQuality, hasEnoughAttributesToResearch } from "@/server/research/comparables";
import { MarketResearchButton } from "./market-research-button";
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

      {comparables.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comparables.map((c) => {
            const confidenceLabel = formatConfidence(c.matchConfidence);
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
                  <span>
                    {c.priceCents !== null
                      ? `${formatCents(c.priceCents)} · ${PRICE_TYPE_BADGE[c.priceType] ?? c.priceType}`
                      : "Price unknown"}
                  </span>
                  {c.condition && <span>Condition: {c.condition}</span>}
                  {c.recency && <span>{c.recency}</span>}
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
