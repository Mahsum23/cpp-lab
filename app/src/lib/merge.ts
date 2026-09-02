/**
 * Merging two progress records — the phone's and whatever the cloud last saw.
 *
 * There is no server to arbitrate, so this has to be a pure function that both sides
 * would compute identically, and it has to be safe to run repeatedly. The governing
 * rule is **never lose a fact**: every field either takes the more-advanced of the two
 * values or keeps both. Last-write-wins is deliberately not used for anything except
 * settings, because "I opened the laptop" should not be able to erase a session.
 *
 * The one field that can't be merged that way is the streak, which is history the
 * records no longer contain — see mergeStreak.
 */
import { emptyDayProgress, type DayProgress, type Progress, type StreakState, type TaskState } from './types';
import { deriveXp } from './xp';

const TASK_RANK: Record<TaskState, number> = { todo: 0, attempted: 1, done: 2 };

/** For "when did this first happen" fields: the earlier real timestamp is the true one. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function mergeNotes(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  if (!x) return b;
  if (!y) return a;
  if (x === y) return a;
  // Two devices, two different notes on the same day. Silently dropping one is the
  // worst outcome on offer; he can delete the half he doesn't want.
  return `${x}\n\n---\n\n${y}`;
}

function mergeDay(local: DayProgress, remote: DayProgress): DayProgress {
  const width = Math.max(local.checklist.length, remote.checklist.length);

  // Answers and their verdicts move as a pair. Taking the answer from one record and
  // the verdict from the other is how you end up scoring a question nobody answered.
  const answers = { ...remote.quiz.answers };
  const correct = { ...remote.quiz.correct };
  for (const [qid, index] of Object.entries(local.quiz.answers)) {
    answers[qid] = index;
    if (qid in local.quiz.correct) correct[qid] = local.quiz.correct[qid];
    else delete correct[qid];
  }

  return {
    weekId: local.weekId || remote.weekId,
    theoryDone: local.theoryDone || remote.theoryDone,
    quiz: {
      answers,
      correct,
      completedAt: earliest(local.quiz.completedAt, remote.quiz.completedAt),
      cleanSweep: local.quiz.cleanSweep || remote.quiz.cleanSweep,
    },
    task: TASK_RANK[local.task] >= TASK_RANK[remote.task] ? local.task : remote.task,
    checklist: Array.from({ length: width }, (_, i) => Boolean(local.checklist[i]) || Boolean(remote.checklist[i])),
    notes: mergeNotes(local.notes, remote.notes),
    teachBackDone: local.teachBackDone || remote.teachBackDone,
    completedAt: earliest(local.completedAt, remote.completedAt),
  };
}

/**
 * A streak is a fact about a sequence of days, and neither record stores that
 * sequence — only the running total. So this can't be recomputed, only chosen.
 *
 * The device that acted most recently wins the count. Not max(): a phone that last
 * synced on a 12-day streak, then sat in a drawer for a week while the streak broke
 * on the laptop, would otherwise resurrect the 12 on its next sync. `longest` is a
 * high-water mark and does take the max, which is what a high-water mark means.
 */
export function mergeStreak(local: StreakState, remote: StreakState): StreakState {
  const key = (s: StreakState) => `${s.lastActiveDate ?? ''}:${String(s.count).padStart(6, '0')}`;
  const lead = key(local) >= key(remote) ? local : remote;
  return {
    count: lead.count,
    longest: Math.max(local.longest, remote.longest),
    lastActiveDate: lead.lastActiveDate,
    // Freezes are earned and spent; the lead record is the one that saw the latest of
    // either. max() would quietly refund a freeze that was already used.
    freezes: lead.freezes,
    freezesEarnedAt: Math.max(local.freezesEarnedAt, remote.freezesEarnedAt),
  };
}

export function mergeProgress(local: Progress, remote: Progress): Progress {
  const days: Record<string, DayProgress> = {};
  for (const id of new Set([...Object.keys(local.days), ...Object.keys(remote.days)])) {
    const l = local.days[id];
    const r = remote.days[id];
    if (l && r) days[id] = mergeDay(l, r);
    else days[id] = { ...emptyDayProgress((l ?? r).weekId), ...(l ?? r) };
  }

  const badges: Record<string, string> = { ...remote.badges };
  for (const [id, at] of Object.entries(local.badges)) {
    badges[id] = earliest(at, badges[id] ?? null) ?? at;
  }

  return {
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    days,
    streak: mergeStreak(local.streak, remote.streak),
    xp: deriveXp(Object.values(days)),
    badges,
    // Theme and pace are how *this* device is set up. Syncing them means turning on
    // dark mode at night on the phone flips the laptop too, which nobody asked for.
    settings: local.settings,
    // Strictly local: this records what's in *this* device's IndexedDB. Accepting the
    // remote's list would convince a fresh install it already has the content, and
    // the app would then never download it.
    loadedWeeks: local.loadedWeeks,
  };
}
