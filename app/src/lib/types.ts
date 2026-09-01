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

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  peekAhead: boolean;
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
    quiz: { answers: {}, completedAt: null, cleanSweep: false },
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
    settings: { theme: 'system', peekAhead: false },
    loadedWeeks: {},
  };
}
