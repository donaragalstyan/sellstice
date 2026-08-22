import type { SellTimingAnalysis } from "@/generated/prisma/client";
import { formatConfidence } from "@/lib/format";
import { hasEnoughAttributesToResearch } from "@/server/research/comparables";
import { SellTimingButton } from "./sell-timing-button";

const STANCE_BADGE: Record<string, { text: string; className: string }> = {
  SELL_NOW: { text: "Sell now", className: "text-green-700 dark:text-green-400 font-medium" },
  WAIT: { text: "Wait", className: "text-amber-700 dark:text-amber-400 font-medium" },
};

export function SellTiming({
  itemId,
  item,
  latestAnalysis,
}: {
  itemId: string;
  item: { brand: string | null; category: string | null };
  latestAnalysis: SellTimingAnalysis | null;
}) {
  const canAssess = hasEnoughAttributesToResearch({
    brand: item.brand,
    color: null,
    category: item.category,
    size: null,
    condition: null,
    notableDetails: null,
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium" style={{ color: "var(--color-muted)" }}>Sell now or wait?</h2>

      <SellTimingButton itemId={itemId} disabled={!canAssess} />

      {latestAnalysis && (
        <div className="card text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={STANCE_BADGE[latestAnalysis.stance]?.className}>
              {STANCE_BADGE[latestAnalysis.stance]?.text ?? latestAnalysis.stance}
            </span>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {formatConfidence(latestAnalysis.confidence)}
            </span>
          </div>
          <p>{latestAnalysis.explanation}</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            AI-generated opinion based on comps, condition, and your goal timeline — not financial advice.
          </p>
        </div>
      )}
    </section>
  );
}
