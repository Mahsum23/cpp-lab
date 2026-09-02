// The contract with content built by app/scripts/build-content.mjs.

export const SCHEMA_VERSION = 1;

export interface QuizOption {
  text: string;
  correct: boolean;
  why: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
}

export interface DayTask {
  markdown: string;
  files: string[];
  compile: string | null;
  checklist: string[];
}

export type DayStatus = 'available' | 'upcoming';

export interface Day {
  id: string;
  day: number;
  title: string;
  estMinutes: number;
  teaser: string | null;
  teachBack: string | null;
  status: DayStatus;
  slug?: string;
  theoryMarkdown: string | null;
  quiz: QuizQuestion[] | null;
  task: DayTask | null;
}

export interface Week {
  schemaVersion: number;
  id: string;
  title: string;
  milestone: string;
  intro: string;
  days: Day[];
}

export interface WeekRef {
  id: string;
  title: string;
  milestone: string;
  days: number;
  availableDays: number;
  url: string;
  contentHash: string;
  available: boolean;
}

export interface Curriculum {
  schemaVersion: number;
  title: string;
  generatedAt: string;
  weeks: WeekRef[];
}

// --- progress -------------------------------------------------------------

export type TaskState = 'todo' | 'attempted' | 'done';

export interface QuizState {
  /** questionId -> index of the option picked. First pick only; no take-backs. */
  answers: Record<string, number>;
  /**
   * questionId -> was that pick right, recorded at the moment he tapped.
   *
   * Redundant with `answers` only for as long as the content stands still. Option
   * order is a build output (build-content.mjs shuffles), so an edited quiz renumbers
   * the options underneath an index that's already been stored — and the score for a
   * day he aced silently rots. The verdict is a fact about what happened; the index
   * is a fact about a file that can change. Store the fact.
   */
  correct: Record<string, boolean>;
  completedAt: string | null;
  /** True only if every question was right on the first pick. */
  cleanSweep: boolean;
}

export interface DayProgress {
  weekId: string;
  theoryDone: boolean;
  quiz: QuizState;
  task: TaskState;
  /** Per-item state of the task checklist, by index. */
  checklist: boolean[];
  notes: string;
  /** Only meaningful on a day that carries a teachBack prompt. */
  teachBackDone: boolean;
  completedAt: string | null;
}

export interface StreakState {
  count: number;
  longest: number;
  /** Local calendar date, YYYY-MM-DD. */
  lastActiveDate: string | null;
  /** Earned every 7 days, never bought. Max 2 banked. */
  freezes: number;
  freezesEarnedAt: number;
}

export type MentorModel = 'claude-haiku-4-5-20251001' | 'claude-sonnet-5' | 'claude-opus-5';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  peekAhead: boolean;
  mentorModel: MentorModel;
}

/**
 * Credentials, kept out of `Progress` on purpose: `Progress` is the object that gets
 * uploaded to the gist, and an API key riding along in a sync payload is exactly the
 * kind of accident that only shows up in someone else's billing.
 */
export interface Secrets {
  /** Fine-grained GitHub PAT, gists scope only. */
  githubToken: string | null;
  /** The gist this device syncs through, discovered or created on connect. */
  gistId: string | null;
  /** Anthropic API key for the mentor chat. */
  anthropicKey: string | null;
}

export function emptySecrets(): Secrets {
  return { githubToken: null, gistId: null, anthropicKey: null };
}

export interface Progress {
  schemaVersion: number;
  days: Record<string, DayProgress>;
  streak: StreakState;
  xp: number;
  badges: Record<string, string>;
  settings: Settings;
  loadedWeeks: Record<string, { contentHash: string; loadedAt: string }>;
}

export function emptyDayProgress(weekId: string): DayProgress {
  return {
    weekId,
    theoryDone: false,
    quiz: { answers: {}, correct: {}, completedAt: null, cleanSweep: false },
    task: 'todo',
    checklist: [],
    notes: '',
    teachBackDone: false,
    completedAt: null,
  };
}

export function defaultProgress(): Progress {
  return {
    schemaVersion: SCHEMA_VERSION,
    days: {},
    streak: { count: 0, longest: 0, lastActiveDate: null, freezes: 0, freezesEarnedAt: 0 },
    xp: 0,
    badges: {},
    settings: { theme: 'system', peekAhead: false, mentorModel: 'claude-sonnet-5' },
    loadedWeeks: {},
  };
}
