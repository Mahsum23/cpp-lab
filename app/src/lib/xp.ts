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
