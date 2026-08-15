import type { ItemAIAnalysis } from "@/generated/prisma/client";
import { formatConfidence } from "@/lib/format";
import { ITEM_CONDITION_LABELS } from "@/lib/item-display";
import { AnalyzeButton } from "./analyze-button";
import { ApplySuggestionButton } from "./apply-suggestion-button";
import type { AppliableField } from "./ai-actions";

interface SuggestionRowProps {
  itemId: string;
  analysisId: string;
  field: AppliableField;
  label: string;
  value: string | null;
  confidence: number | null;
  applied: boolean;
}

function SuggestionRow({ itemId, analysisId, field, label, value, confidence, applied }: SuggestionRowProps) {
  if (value == null) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">{label}: not visible in these photos</span>
      </div>
    );
  }

  const confidenceLabel = formatConfidence(confidence);

  return (
    <div className="flex items-center justify-between text-sm">
      <span>
        <span className="text-gray-500">{label}:</span> {value}
        {confidenceLabel && <span className="ml-1 text-xs text-gray-400">({confidenceLabel})</span>}
      </span>
      <ApplySuggestionButton itemId={itemId} analysisId={analysisId} field={field} applied={applied} />
    </div>
  );
}

function SuggestionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="text-sm">
      <span className="text-gray-500">{title}:</span>{" "}
      <span>{items.join(", ")}</span>
    </div>
  );
}

export function AiSuggestions({
  itemId,
  photoCount,
  latestAnalysis,
}: {
  itemId: string;
  photoCount: number;
  latestAnalysis: ItemAIAnalysis | null;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-gray-600">AI suggestions</h2>
      <AnalyzeButton itemId={itemId} disabled={photoCount === 0} />

      {latestAnalysis && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-300 p-4">
          <SuggestionRow
            itemId={itemId}
            analysisId={latestAnalysis.id}
            field="brand"
            label="Brand"
            value={latestAnalysis.brandValue}
            confidence={latestAnalysis.brandConfidence}
            applied={latestAnalysis.appliedFields.includes("brand")}
          />
          <SuggestionRow
            itemId={itemId}
            analysisId={latestAnalysis.id}
            field="color"
            label="Color"
            value={latestAnalysis.colorValue}
            confidence={latestAnalysis.colorConfidence}
            applied={latestAnalysis.appliedFields.includes("color")}
          />
          <SuggestionRow
            itemId={itemId}
            analysisId={latestAnalysis.id}
            field="category"
            label="Category"
            value={latestAnalysis.categoryValue}
            confidence={latestAnalysis.categoryConfidence}
            applied={latestAnalysis.appliedFields.includes("category")}
          />
          <SuggestionRow
            itemId={itemId}
            analysisId={latestAnalysis.id}
            field="condition"
            label="Condition"
            value={
              latestAnalysis.conditionValue
                ? ITEM_CONDITION_LABELS[latestAnalysis.conditionValue]
                : null
            }
            confidence={latestAnalysis.conditionConfidence}
            applied={latestAnalysis.appliedFields.includes("condition")}
          />

          {latestAnalysis.itemTypeValue && (
            <div className="text-sm">
              <span className="text-gray-500">Item type (for reference):</span>{" "}
              {latestAnalysis.itemTypeValue}
            </div>
          )}

          <SuggestionList title="Style" items={latestAnalysis.styleKeywords} />
          <SuggestionList title="Visible details" items={latestAnalysis.visibleDetails} />
          <SuggestionList
            title="Consider adding photos of"
            items={latestAnalysis.missingPhotoSuggestions}
          />

          <p className="text-xs text-gray-400">
            AI-generated suggestions — review before applying. Nothing here changes your item
            until you click Apply.
          </p>
        </div>
      )}
    </section>
  );
}
