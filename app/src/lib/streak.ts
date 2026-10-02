import type { StreakState } from './types';
import { daysBetween, localDateOf } from './date';

export const MAX_FREEZES = 2;
const FREEZE_EVERY = 7;

export interface StreakOutcome {
  streak: StreakState;
  /** What actually happened, so the UI can say it out loud rather than guess. */
  event: 'first' | 'extended' | 'already-today' | 'frozen' | 'reset';
  freezeEarned: boolean;
}

/**
 * Advance the streak for a completed session.
 *
 * The rules, per DESIGN.md §4: one session a day keeps it alive; a single missed
 * day is absorbed by a banked freeze if you have one; anything longer resets. No
 * paid freezes, no guilt, no "your streak is in danger" theatre.
 */
export function completeDay(prev: StreakState, date: string): StreakOutcome {
  if (prev.lastActiveDate === date) {
    return { streak: prev, event: 'already-today', freezeEarned: false };
  }

  let event: StreakOutcome['event'];
  let count: number;
  let freezes = prev.freezes;

  if (!prev.lastActiveDate) {
    count = 1;
    event = 'first';
  } else {
    const gap = daysBetween(prev.lastActiveDate, date);
    if (gap === 1) {
      count = prev.count + 1;
      event = 'extended';
    } else if (gap === 2 && freezes > 0) {
      // Exactly one day missed, and we have a freeze banked. Spend it.
      freezes -= 1;
      count = prev.count + 1;
      event = 'frozen';
    } else {
      count = 1;
      event = 'reset';
    }
  }

  // A freeze every 7th day of an unbroken run. Earned, capped, never purchasable.
  let freezesEarnedAt = prev.freezesEarnedAt;
  let freezeEarned = false;
  if (count > 0 && count % FREEZE_EVERY === 0 && count !== freezesEarnedAt && freezes < MAX_FREEZES) {
    freezes += 1;
    freezesEarnedAt = count;
    freezeEarned = true;
  }
  if (event === 'reset' || event === 'first') freezesEarnedAt = 0;

  return {
    streak: {
      count,
      longest: Math.max(prev.longest, count),
      lastActiveDate: date,
      freezes,
      freezesEarnedAt,
    },
    event,
    freezeEarned,
  };
}

/** The streak as it stands *right now*, without recording anything. A run only
 *  survives if the last session was today or yesterday (or a freeze covers it). */
export function displayedStreak(s: StreakState, date: string): number {
  if (!s.lastActiveDate) return 0;
  const gap = daysBetween(s.lastActiveDate, date);
  if (gap <= 1) return s.count;
  if (gap === 2 && s.freezes > 0) return s.count;
  return 0;
}

/** True when today would break the run unless a session gets done. */
export function atRisk(s: StreakState, date: string): boolean {
  return s.count > 0 && s.lastActiveDate !== null && daysBetween(s.lastActiveDate, date) === 1;
}

const NO_STREAK: StreakState = { count: 0, longest: 0, lastActiveDate: null, freezes: 0, freezesEarnedAt: 0 };

/**
 * The streak, rebuilt from the finished days themselves.
 *
 * The stored counter can't be merged across devices: it is a running total, and a device
 * that finished a day before pulling the other's record computes its total from a stale
 * one. Choosing "the most recently active device" then keeps that wrong total for good —
 * a day finished on the phone yesterday and one on the laptop today came out as a streak
 * of 1. The days, though, merge exactly (each keeps its earliest completedAt), so the
 * streak is replayed from them through the same rules as above, freezes and all. Like
 * XP, it is derived from the ledger rather than incremented beside it, so the two can
 * never disagree.
 *
 * `prev` only contributes `longest`, a high-water mark: a run counted before the ledger
 * could lose a date (a day finished twice keeps its earlier date) should not shrink.
 */
export function deriveStreak(
  days: Iterable<{ completedAt: string | null; practice?: { rounds: { at: string }[] } }>,
  prev: StreakState = NO_STREAK,
): StreakState {
  const dates = new Set<string>();
  for (const d of days) {
    if (d.completedAt) dates.add(localDateOf(d.completedAt));
    // A finished practice round is a day's work too: staying on a concept must not
    // cost the streak that moving on would have kept.
    for (const r of d.practice?.rounds ?? []) dates.add(localDateOf(r.at));
  }
  let s = NO_STREAK;
  for (const date of [...dates].sort()) s = completeDay(s, date).streak;
  return { ...s, longest: Math.max(s.longest, prev.longest) };
}
