import type { Progress, Week } from './types';

export interface Badge {
  id: string;
  name: string;
  /** Earned copy, in the mentor's voice. No "You're a superstar!!!". */
  blurb: string;
  glyph: string;
  test: (ctx: BadgeContext) => boolean;
}

export interface BadgeContext {
  progress: Progress;
  weeks: Week[];
}

const dayDone = (p: Progress, id: string) => Boolean(p.days[id]?.completedAt);

export const BADGES: Badge[] = [
  {
    id: 'first-socket',
    name: 'First Socket',
    blurb: 'You asked the kernel for a socket and it said yes. Everything else is detail.',
    glyph: '🔌',
    test: ({ progress }) => dayDone(progress, 'day-01'),
  },
  {
    id: 'byte-order-boss',
    name: 'Byte-Order Boss',
    blurb: 'You can now explain why the number looked backwards. Most people never can.',
    glyph: '🔁',
    test: ({ progress }) => dayDone(progress, 'day-02'),
  },
  {
    id: 'clean-sweep',
    name: 'Clean Sweep',
    blurb: 'A quiz with no wrong turns. The distractors were real — you just weren’t fooled.',
    glyph: '🎯',
    test: ({ progress }) => Object.values(progress.days).some((d) => d.quiz.cleanSweep),
  },
  {
    id: 'honest-learner',
    name: 'Honest Learner',
    blurb: 'Three sessions where you wrote down what confused you. That column is the valuable one.',
    glyph: '✎',
    test: ({ progress }) =>
      Object.values(progress.days).filter((d) => d.notes.trim().length > 0).length >= 3,
  },
  {
    id: 'streak-7',
    name: 'Seven Straight',
    blurb: 'A week without missing. Consistency is the whole trick; the C++ is downstream of it.',
    glyph: '🔥',
    test: ({ progress }) => progress.streak.longest >= 7,
  },
  {
    id: 'streak-30',
    name: 'Thirty Straight',
    blurb: 'A month. At this point it is a habit, not a project.',
    glyph: '🌋',
    test: ({ progress }) => progress.streak.longest >= 30,
  },
  {
    id: 'week-01-complete',
    name: 'Raw Sockets, Done',
    blurb: 'You built the black box by hand. Asio is now a convenience, not a mystery.',
    glyph: '🧱',
    test: ({ progress, weeks }) => weekComplete(progress, weeks, 'week-01'),
  },
  {
    id: 'teach-back',
    name: 'Teach-back Passed',
    blurb: 'You explained it in your own words. That’s the part that actually sticks.',
    glyph: '🗣',
    test: ({ progress }) => Object.values(progress.days).some((d) => d.teachBackDone),
  },
];

/**
 * Every day in the week's roster, not just the ones written so far — otherwise
 * finishing Day 1 of an 8-day week hands out the week badge on the spot.
 */
function weekComplete(progress: Progress, weeks: Week[], weekId: string): boolean {
  const week = weeks.find((w) => w.id === weekId);
  if (!week?.days.length) return false;
  return week.days.every((d) => d.status === 'available' && dayDone(progress, d.id));
}

/** Returns ids newly earned by this state. Pure — the caller records them. */
export function evaluate(ctx: BadgeContext): string[] {
  return BADGES.filter((b) => !ctx.progress.badges[b.id] && b.test(ctx)).map((b) => b.id);
}

export function byId(id: string): Badge | undefined {
  return BADGES.find((b) => b.id === id);
}
