import {
  defaultProgress,
  emptyDayProgress,
  type Curriculum,
  type Day,
  type Progress,
  type TaskState,
  type Week,
} from './types';
import * as store from './storage';
import { fetchCurriculum, fetchWeek, SchemaTooNewError } from './content';
import { completeDay as advanceStreak, displayedStreak, atRisk } from './streak';
import { evaluate as evaluateBadges } from './badges';
import { XP_CLEAN_SWEEP, XP_SESSION } from './xp';
import { localDateOf, today } from './date';

export type DayState = 'done' | 'current' | 'unlocked' | 'locked' | 'upcoming';

export interface SyncState {
  status: 'idle' | 'checking' | 'ok' | 'offline' | 'error';
  message: string | null;
  /** Weeks the server advertises that we haven't downloaded yet. */
  newWeeks: string[];
}

class AppStore {
  progress = $state<Progress>(defaultProgress());
  weeks = $state<Week[]>([]);
  curriculum = $state<Curriculum | null>(null);
  ready = $state(false);
  sync = $state<SyncState>({ status: 'idle', message: null, newWeeks: [] });
  /** Badge ids earned by the most recent action, for the celebration sheet. */
  justEarned = $state<string[]>([]);
  lastXpGain = $state(0);
  installable = $state(false);

  // --- derived ------------------------------------------------------------

  get availableDays(): { week: Week; day: Day }[] {
    return this.weeks.flatMap((week) =>
      week.days.filter((d) => d.status === 'available').map((day) => ({ week, day })),
    );
  }

  /** The first authored day that isn't finished. The whole app points here. */
  get current(): { week: Week; day: Day } | null {
    return this.availableDays.find(({ day }) => !this.progress.days[day.id]?.completedAt) ?? null;
  }

  get streakCount(): number {
    return displayedStreak(this.progress.streak, today());
  }

  get streakAtRisk(): boolean {
    return atRisk(this.progress.streak, today());
  }

  get completedToday(): boolean {
    const t = today();
    return Object.values(this.progress.days).some(
      (d) => d.completedAt && localDateOf(d.completedAt) === t,
    );
  }

  get daysDone(): number {
    return Object.values(this.progress.days).filter((d) => d.completedAt).length;
  }

  /** Days he flagged as confusing — the honest panel on Stats. */
  get notedDays(): { day: Day; week: Week; notes: string }[] {
    return this.availableDays
      .filter(({ day }) => this.progress.days[day.id]?.notes.trim())
      .map(({ week, day }) => ({ week, day, notes: this.progress.days[day.id].notes }));
  }

  dayProgress(dayId: string, weekId: string) {
    return this.progress.days[dayId] ?? emptyDayProgress(weekId);
  }

  /** Segments closed on the day ring: theory, quiz, task. */
  segments(day: Day, weekId: string): boolean[] {
    const p = this.dayProgress(day.id, weekId);
    return [p.theoryDone, Boolean(p.quiz.completedAt) || !day.quiz?.length, p.task === 'done'];
  }

  stateOf(day: Day): DayState {
    if (day.status === 'upcoming') return 'upcoming';
    if (this.progress.days[day.id]?.completedAt) return 'done';
    const cur = this.current;
    if (cur?.day.id === day.id) return 'current';
    return this.progress.settings.peekAhead ? 'unlocked' : 'locked';
  }

  weekProgress(week: Week): { done: number; total: number } {
    const days = week.days.filter((d) => d.status === 'available');
    return {
      done: days.filter((d) => this.progress.days[d.id]?.completedAt).length,
      total: week.days.length,
    };
  }

  findDay(weekId: string, dayId: string): { week: Week; day: Day } | null {
    const week = this.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    return week && day ? { week, day } : null;
  }

  // --- lifecycle ----------------------------------------------------------

  async init() {
    this.progress = await store.loadProgress();
    this.weeks = await store.loadAllWeeks();
    this.applyTheme();
    this.ready = true;
    void store.requestPersistence();
    void this.refresh();
  }

  /**
   * Check the manifest. New weeks are offered, not force-fed; a changed hash on a
   * week we already hold refreshes silently, because that's a typo fix, not new work.
   */
  async refresh(): Promise<void> {
    this.sync = { ...this.sync, status: 'checking', message: null };
    try {
      const curriculum = await fetchCurriculum();
      this.curriculum = curriculum;

      const newWeeks: string[] = [];
      for (const ref of curriculum.weeks) {
        if (!ref.available) continue;
        const held = this.progress.loadedWeeks[ref.id];
        if (!held) {
          // Week 1 arrives without ceremony; later weeks wait for a tap.
          if (this.weeks.length === 0) await this.downloadWeek(ref.id);
          else newWeeks.push(ref.id);
        } else if (held.contentHash !== ref.contentHash) {
          await this.downloadWeek(ref.id);
        }
      }
      this.sync = { status: 'ok', message: null, newWeeks };
    } catch (err) {
      const offline = !navigator.onLine;
      this.sync = {
        ...this.sync,
        status: offline ? 'offline' : 'error',
        message:
          err instanceof SchemaTooNewError
            ? 'New content needs a newer app — close and reopen to update.'
            : offline
              ? 'Offline — showing what you already have.'
              : 'Could not reach the curriculum.',
      };
    }
  }

  async downloadWeek(weekId: string): Promise<void> {
    const ref = this.curriculum?.weeks.find((w) => w.id === weekId);
    if (!ref) return;
    const week = await fetchWeek(ref.url);
    await store.saveWeek(week);
    this.weeks = [...this.weeks.filter((w) => w.id !== week.id), week].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    this.progress.loadedWeeks[weekId] = {
      contentHash: ref.contentHash,
      loadedAt: new Date().toISOString(),
    };
    this.sync = { ...this.sync, newWeeks: this.sync.newWeeks.filter((id) => id !== weekId) };
    await this.persist();
  }

  private async persist() {
    await store.saveProgress($state.snapshot(this.progress));
  }

  private mutable(dayId: string, weekId: string) {
    this.progress.days[dayId] ??= emptyDayProgress(weekId);
    return this.progress.days[dayId];
  }

  // --- session actions ----------------------------------------------------

  async markTheoryDone(day: Day, weekId: string) {
    this.mutable(day.id, weekId).theoryDone = true;
    await this.persist();
  }

  /** One shot per question — the answer is recorded on first tap, then explained. */
  async answerQuiz(day: Day, weekId: string, questionId: string, optionIndex: number) {
    const p = this.mutable(day.id, weekId);
    if (questionId in p.quiz.answers) return;
    p.quiz.answers[questionId] = optionIndex;
    await this.persist();
  }

  async finishQuiz(day: Day, weekId: string) {
    const p = this.mutable(day.id, weekId);
    const questions = day.quiz ?? [];
    p.quiz.cleanSweep =
      questions.length > 0 &&
      questions.every((q) => questions.length && q.options[p.quiz.answers[q.id]]?.correct);
    p.quiz.completedAt = new Date().toISOString();
    await this.persist();
  }

  quizScore(day: Day, weekId: string): { correct: number; total: number } {
    const p = this.dayProgress(day.id, weekId);
    const questions = day.quiz ?? [];
    return {
      correct: questions.filter((q) => q.options[p.quiz.answers[q.id]]?.correct).length,
      total: questions.length,
    };
  }

  async setTaskState(day: Day, weekId: string, state: TaskState) {
    this.mutable(day.id, weekId).task = state;
    await this.persist();
  }

  async toggleChecklist(day: Day, weekId: string, index: number) {
    const p = this.mutable(day.id, weekId);
    const next = [...p.checklist];
    next[index] = !next[index];
    p.checklist = next;
    await this.persist();
  }

  async setNotes(day: Day, weekId: string, notes: string) {
    this.mutable(day.id, weekId).notes = notes;
    await this.persist();
  }

  async setTeachBackDone(day: Day, weekId: string, done: boolean) {
    this.mutable(day.id, weekId).teachBackDone = done;
    await this.persist();
  }

  /** Closes the day: streak, XP, badges. Idempotent — a second call is a no-op. */
  async completeDay(day: Day, weekId: string) {
    const p = this.mutable(day.id, weekId);
    if (p.completedAt) return;

    p.completedAt = new Date().toISOString();
    p.theoryDone = true;
    p.task = 'done';

    const gain = XP_SESSION + (p.quiz.cleanSweep ? XP_CLEAN_SWEEP : 0);
    this.progress.xp += gain;
    this.lastXpGain = gain;

    const outcome = advanceStreak($state.snapshot(this.progress.streak), today());
    this.progress.streak = outcome.streak;

    const earned = evaluateBadges({
      progress: $state.snapshot(this.progress),
      weeks: $state.snapshot(this.weeks) as Week[],
    });
    const at = new Date().toISOString();
    for (const id of earned) this.progress.badges[id] = at;
    this.justEarned = earned;

    await this.persist();
  }

  clearCelebration() {
    this.justEarned = [];
    this.lastXpGain = 0;
  }

  // --- settings -----------------------------------------------------------

  async setTheme(theme: Progress['settings']['theme']) {
    this.progress.settings.theme = theme;
    this.applyTheme();
    await this.persist();
  }

  async setPeekAhead(on: boolean) {
    this.progress.settings.peekAhead = on;
    await this.persist();
  }

  applyTheme() {
    const t = this.progress.settings.theme;
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = t;
  }

  exportJSON(): string {
    return JSON.stringify(
      { app: 'cpp-lab', exportedAt: new Date().toISOString(), progress: $state.snapshot(this.progress) },
      null,
      2,
    );
  }

  async importJSON(text: string): Promise<void> {
    const parsed = JSON.parse(text);
    const incoming = parsed?.progress ?? parsed;
    if (!incoming || typeof incoming !== 'object' || !('days' in incoming)) {
      throw new Error("That doesn't look like a cpp-lab export.");
    }
    await store.saveProgress(incoming);
    this.progress = await store.loadProgress();
    this.applyTheme();
  }

  async resetAll() {
    await store.clearAll();
    this.progress = defaultProgress();
    this.weeks = [];
    this.applyTheme();
    await this.refresh();
  }
}

export const app = new AppStore();
