/**
 * Shared minimum-interval-between-runs check, used by every AI capability
 * that makes a billed call per item (item analysis, photo coach, ...). Pure
 * so the boundary is testable without waiting real time; each capability
 * wraps this with its own cooldown duration.
 */
export function getCooldownRemainingMs(
  lastRunAt: Date | null,
  now: Date,
  cooldownMs: number,
): number {
  if (!lastRunAt) return 0;
  const elapsed = now.getTime() - lastRunAt.getTime();
  return Math.max(0, cooldownMs - elapsed);
}
