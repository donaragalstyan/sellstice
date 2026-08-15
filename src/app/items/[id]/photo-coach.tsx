import type { PhotoCoachAnalysis, PhotoCoachPhotoScore, ItemPhoto } from "@/generated/prisma/client";
import { MISSING_SHOT_LABELS } from "@/lib/item-display";
import { PhotoCoachButton } from "./photo-coach-button";

type ScoreWithPhoto = PhotoCoachPhotoScore & { photo: ItemPhoto };
type AnalysisWithScores = PhotoCoachAnalysis & { scores: ScoreWithPhoto[] };

function capitalize(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function PhotoCoach({
  itemId,
  photoCount,
  latestAnalysis,
}: {
  itemId: string;
  photoCount: number;
  latestAnalysis: AnalysisWithScores | null;
}) {
  const sortedScores = latestAnalysis
    ? [...latestAnalysis.scores].sort((a, b) => a.photoOrder - b.photoOrder)
    : [];
  const bestCover = sortedScores.find((s) => s.isBestCover) ?? null;

  const issues = sortedScores.flatMap((s) => {
    const label = `Photo ${s.photoOrder + 1}`;
    return [
      !s.lightingOk && s.lightingFeedback ? `${label} ${s.lightingFeedback}.` : null,
      !s.framingOk && s.framingFeedback ? `${label} ${s.framingFeedback}.` : null,
      !s.backgroundOk && s.backgroundFeedback ? `${label} ${s.backgroundFeedback}.` : null,
      !s.shapeVisibleOk && s.shapeVisibleFeedback
        ? `${label} ${s.shapeVisibleFeedback}.`
        : null,
    ].filter((line): line is string => line !== null);
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-gray-600">Photo coach</h2>
      <PhotoCoachButton itemId={itemId} disabled={photoCount === 0} />

      {latestAnalysis && (
        <div className="flex flex-col gap-3 rounded-lg border border-gray-300 p-4">
          {bestCover && (
            <p className="text-sm font-medium">
              Best cover: Photo {bestCover.photoOrder + 1} — {bestCover.score.toFixed(1)}/10
            </p>
          )}

          {issues.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {issues.map((line) => (
                <li key={line}>{capitalize(line)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">No issues found with the current photos.</p>
          )}

          {latestAnalysis.missingShots.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {latestAnalysis.missingShots.map((shot) => (
                <li key={shot}>{MISSING_SHOT_LABELS[shot] ?? shot}</li>
              ))}
            </ul>
          )}

          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {sortedScores.map((s) => (
              <li key={s.id} className="flex flex-col gap-1">
                <div className="relative aspect-square overflow-hidden rounded-md bg-gray-100 dark:bg-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.photo.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                    {s.score.toFixed(1)}
                  </span>
                  {s.isBestCover && (
                    <span className="absolute top-1 right-1 rounded bg-blue-600 px-1.5 py-0.5 text-xs font-medium text-white">
                      Cover
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">Photo {s.photoOrder + 1}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-gray-400">
            AI-generated feedback — advice only. Your photos are never changed or regenerated.
          </p>
        </div>
      )}
    </section>
  );
}
