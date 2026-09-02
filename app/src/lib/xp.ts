export const XP_SESSION = 40;
export const XP_CLEAN_SWEEP = 20;
export const XP_PER_LEVEL = 200;

/** XP is feedback, not a currency — nothing is ever spent, nothing is gated by it. */
export function levelOf(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function levelProgress(xp: number): { into: number; needed: number; pct: number } {
  const into = xp % XP_PER_LEVEL;
  return { into, needed: XP_PER_LEVEL, pct: (into / XP_PER_LEVEL) * 100 };
}

/**
 * XP recomputed from the day records rather than read from the stored counter.
 *
 * The counter is an accumulator, and accumulators don't merge: sync two devices that
 * each awarded 40 XP for the same session and adding gives 80, while taking the max
 * loses a session done on the other device. The days are the ledger; this is the sum.
 */
export function deriveXp(days: Iterable<{ completedAt: string | null; quiz: { cleanSweep: boolean } }>): number {
  let total = 0;
  for (const d of days) {
    if (!d.completedAt) continue;
    total += XP_SESSION + (d.quiz.cleanSweep ? XP_CLEAN_SWEEP : 0);
  }
  return total;
}
