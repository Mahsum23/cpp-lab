import {
  defaultProgress,
  emptyDayProgress,
  emptySecrets,
  type Curriculum,
  type Day,
  type MentorProvider,
  type Progress,
  type Secrets,
  type TaskState,
  type Week,
} from './types';
import * as store from './storage';
import * as cloud from './cloud';
import { listModels, normalizeKey, PROVIDERS, type ModelChoice } from './mentor';
import { mergeProgress } from './merge';
import { fetchCurriculum, fetchWeek, SchemaTooNewError } from './content';
import { completeDay as advanceStreak, displayedStreak, atRisk } from './streak';
import { evaluate as evaluateBadges } from './badges';
import { deriveXp, XP_CLEAN_SWEEP, XP_SESSION } from './xp';
import { localDateOf, today } from './date';

export type DayState = 'done' | 'current' | 'unlocked' | 'locked' | 'upcoming';

export interface SyncState {
  status: 'idle' | 'checking' | 'ok' | 'offline' | 'error';
  message: string | null;
  /** Weeks the server advertises that we haven't downloaded yet. */
  newWeeks: string[];
}

/** Progress sync, which is a different thing from content sync above. */
export interface CloudState {
  status: 'off' | 'idle' | 'syncing' | 'ok' | 'error';
  lastSyncAt: string | null;
  /** Which device wrote the copy we last read. */
  lastDevice: string | null;
  error: string | null;
}

/** Long enough that a tapped checklist doesn't fire a request per tap. */
const PUSH_DEBOUNCE_MS = 4000;

class AppStore {
  progress = $state<Progress>(defaultProgress());
  weeks = $state<Week[]>([]);
  curriculum = $state<Curriculum | null>(null);
  ready = $state(false);
  sync = $state<SyncState>({ status: 'idle', message: null, newWeeks: [] });
  secrets = $state<Secrets>(emptySecrets());
  cloud = $state<CloudState>({ status: 'off', lastSyncAt: null, lastDevice: null, error: null });
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
    const base = [p.theoryDone, Boolean(p.quiz.completedAt) || !day.quiz?.length, p.task === 'done'];
    // Only days that actually pose a teach-back get the fourth arc, so a day without
    // one still reads as complete at three.
    return day.teachBack ? [...base, p.teachBackDone] : base;
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
    this.secrets = await store.loadSecrets();
    this.weeks = await store.loadAllWeeks();
    this.applyTheme();
    // Seeded, not fetched: the real list costs a round trip and is only ever looked
    // at on the Settings screen, which asks for it when it opens.
    this.mentorModels = PROVIDERS[this.mentorProvider].models;
    this.ready = true;
    if (this.cloudConnected) this.cloud = { ...this.cloud, status: 'idle' };
    void store.requestPersistence();
    // Sequenced, not raced: refresh() writes loadedWeeks when it downloads a week,
    // and syncNow() replaces `progress` wholesale with its merge result. Overlapping
    // them can drop that write and re-download the week on the next launch.
    void this.refresh().then(() => this.syncNow());
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
    this.schedulePush();
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
    // The verdict is settled now, against the content he actually saw. Recomputing it
    // later from the index would re-read a file that may have been edited since.
    const question = day.quiz?.find((q) => q.id === questionId);
    p.quiz.correct[questionId] = Boolean(question?.options[optionIndex]?.correct);
    await this.persist();
  }

  /** Was this question answered correctly? Falls back to the stored index for day
   *  records written before the verdict was kept. */
  private wasCorrect(day: Day, weekId: string, questionId: string): boolean {
    const p = this.dayProgress(day.id, weekId);
    if (questionId in p.quiz.correct) return p.quiz.correct[questionId];
    const question = day.quiz?.find((q) => q.id === questionId);
    return Boolean(question?.options[p.quiz.answers[questionId]]?.correct);
  }

  async finishQuiz(day: Day, weekId: string) {
    const p = this.mutable(day.id, weekId);
    const questions = day.quiz ?? [];
    p.quiz.cleanSweep =
      questions.length > 0 && questions.every((q) => this.wasCorrect(day, weekId, q.id));
    p.quiz.completedAt = new Date().toISOString();
    await this.persist();
  }

  quizScore(day: Day, weekId: string): { correct: number; total: number } {
    const p = this.dayProgress(day.id, weekId);
    const questions = day.quiz ?? [];
    return {
      correct: questions.filter((q) => q.id in p.quiz.answers && this.wasCorrect(day, weekId, q.id)).length,
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
    // teachBackDone is deliberately NOT set here. It's the examiner's ruling, and a
    // day can be finished without passing it — that's the honest outcome, and the
    // ring should keep showing the open arc until he goes back and earns it.

    const gain = XP_SESSION + (p.quiz.cleanSweep ? XP_CLEAN_SWEEP : 0);
    this.lastXpGain = gain;
    // Derived, not incremented — see deriveXp. The counter and the ledger can't
    // disagree if there's only a ledger.
    this.progress.xp = deriveXp(Object.values($state.snapshot(this.progress).days));

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

  // --- cloud sync ---------------------------------------------------------

  get cloudConnected(): boolean {
    return Boolean(this.secrets.githubToken && this.secrets.gistId);
  }

  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set while we're writing our own merge result back, so the save it triggers
   *  doesn't schedule a push that re-enters the sync we're already inside. */
  private applyingRemote = false;

  private schedulePush() {
    if (!this.cloudConnected || this.applyingRemote) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.pushNow(), PUSH_DEBOUNCE_MS);
  }

  /** Send anything pending right now — called when the app goes to the background,
   *  which on iOS is the last moment we're reliably allowed to run. */
  async flushCloud(): Promise<void> {
    if (!this.pushTimer) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = null;
    await this.pushNow();
  }

  private async pushNow(): Promise<void> {
    this.pushTimer = null;
    const { githubToken, gistId } = this.secrets;
    if (!githubToken || !gistId) return;
    try {
      await cloud.push(githubToken, gistId, $state.snapshot(this.progress));
      this.cloud = {
        status: 'ok',
        lastSyncAt: new Date().toISOString(),
        lastDevice: cloud.deviceName(),
        error: null,
      };
    } catch (err) {
      // A failed push is not worth interrupting a session over — the local copy is
      // still the real one, and the next sync will carry it.
      this.cloud = { ...this.cloud, status: 'error', error: errorText(err) };
    }
  }

  /**
   * Pull, merge, push. Runs on launch, on foreground, and on demand.
   *
   * Merge rather than choose: with no server to arbitrate, "newest wins" would let
   * opening the laptop erase a session done on the phone that morning.
   */
  async syncNow(): Promise<void> {
    const { githubToken, gistId } = this.secrets;
    if (!githubToken || !gistId || this.cloud.status === 'syncing') return;

    this.cloud = { ...this.cloud, status: 'syncing', error: null };
    try {
      const remote = await cloud.pull(githubToken, gistId);
      if (remote) {
        const local = $state.snapshot(this.progress);
        const merged = mergeProgress(local, remote.progress);
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          this.applyingRemote = true;
          this.progress = merged;
          await store.saveProgress($state.snapshot(this.progress));
          this.applyingRemote = false;
          this.applyTheme();
        }
      }
      await cloud.push(githubToken, gistId, $state.snapshot(this.progress));
      this.cloud = {
        status: 'ok',
        lastSyncAt: new Date().toISOString(),
        lastDevice: remote?.device ?? cloud.deviceName(),
        error: null,
      };
    } catch (err) {
      this.applyingRemote = false;
      this.cloud = { ...this.cloud, status: 'error', error: errorText(err) };
    }
  }

  /** Returns whether it adopted an existing gist or made a new one — the difference
   *  matters to the message shown, because one of them means "your history is back". */
  async connectCloud(token: string): Promise<'adopted' | 'created'> {
    this.cloud = { ...this.cloud, status: 'syncing', error: null };
    try {
      const existing = await cloud.findGist(token);
      const gistId = existing ?? (await cloud.createGist(token, $state.snapshot(this.progress)));
      this.secrets = { ...this.secrets, githubToken: token, gistId };
      await store.saveSecrets($state.snapshot(this.secrets));

      if (existing) {
        await this.syncNow();
        if (this.cloud.status === 'error') throw new cloud.CloudError(this.cloud.error ?? 'Sync failed.');
        return 'adopted';
      }
      this.cloud = {
        status: 'ok',
        lastSyncAt: new Date().toISOString(),
        lastDevice: cloud.deviceName(),
        error: null,
      };
      return 'created';
    } catch (err) {
      this.cloud = { ...this.cloud, status: 'error', error: errorText(err) };
      throw err;
    }
  }

  /** Forgets the token on this device. The gist itself is left alone — deleting a
   *  backup as a side effect of signing out of one phone would be indefensible. */
  async disconnectCloud(): Promise<void> {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.secrets = { ...this.secrets, githubToken: null, gistId: null };
    await store.saveSecrets($state.snapshot(this.secrets));
    this.cloud = { status: 'off', lastSyncAt: null, lastDevice: null, error: null };
  }

  get gistUrl(): string | null {
    return this.secrets.gistId ? cloud.gistUrl(this.secrets.gistId) : null;
  }

  // --- mentor -------------------------------------------------------------

  /** Models the active provider says it can run. Fetched, not hardcoded — see listModels. */
  mentorModels = $state<ModelChoice[]>([]);
  mentorModelsError = $state<string | null>(null);
  loadingModels = $state(false);

  get mentorProvider(): MentorProvider {
    return this.progress.settings.mentorProvider;
  }

  /** The key for whichever provider is selected, or null. */
  get mentorKey(): string | null {
    return this.mentorProvider === 'gemini' ? this.secrets.geminiKey : this.secrets.anthropicKey;
  }

  get mentorReady(): boolean {
    return Boolean(this.mentorKey);
  }

  async setMentorKey(provider: MentorProvider, key: string | null) {
    const value = key ? normalizeKey(key) || null : null;
    this.secrets =
      provider === 'gemini'
        ? { ...this.secrets, geminiKey: value }
        : { ...this.secrets, anthropicKey: value };
    await store.saveSecrets($state.snapshot(this.secrets));
    if (value && provider === this.mentorProvider) await this.refreshMentorModels();
  }

  async setMentorProvider(provider: MentorProvider) {
    if (provider === this.mentorProvider) return;
    this.progress.settings.mentorProvider = provider;
    // The old model id belongs to the old provider's namespace; carrying it across
    // just produces a 404 on the first question.
    this.progress.settings.mentorModel = PROVIDERS[provider].defaultModel;
    this.mentorModels = PROVIDERS[provider].models;
    this.mentorModelsError = null;
    await this.persist();
    if (this.mentorKey) await this.refreshMentorModels();
  }

  async setMentorModel(model: string) {
    this.progress.settings.mentorModel = model;
    await this.persist();
  }

  /**
   * A question just came back "that model is gone". Retire it and move on.
   *
   * The list-based heal below can't catch this on its own: Google keeps retired models
   * in models.list, looking perfectly healthy, so a stored id that 404s on every single
   * question still passes the "is it in the list?" check and stays selected forever.
   * A 404 is the only reliable evidence the model is dead, so it's what we act on.
   */
  async retireModel(dead: string): Promise<void> {
    if (this.progress.settings.mentorModel !== dead) return;
    const next = this.mentorModels.find((m) => m.id !== dead);
    if (!next) return;
    this.progress.settings.mentorModel = next.id;
    await this.persist();
    await this.refreshMentorModels();
  }

  /**
   * Ask the provider what it actually offers, and heal the stored choice if it's gone.
   *
   * Without the healing step a retired model id sits in settings forever, failing
   * every question with a 404 and no obvious way out — the user has no reason to
   * suspect the model picker rather than their key.
   */
  async refreshMentorModels(): Promise<void> {
    const provider = this.mentorProvider;
    const key = this.mentorKey;
    if (!key) {
      this.mentorModels = PROVIDERS[provider].models;
      return;
    }
    this.loadingModels = true;
    this.mentorModelsError = null;
    try {
      const models = await listModels(provider, key);
      // Provider may have been switched while this was in flight.
      if (provider !== this.mentorProvider) return;
      this.mentorModels = models;
      if (models.length && !models.some((m) => m.id === this.progress.settings.mentorModel)) {
        this.progress.settings.mentorModel = models[0].id;
        await this.persist();
      }
    } catch (err) {
      if (provider !== this.mentorProvider) return;
      this.mentorModels = PROVIDERS[provider].models;
      this.mentorModelsError = errorText(err);
    } finally {
      this.loadingModels = false;
    }
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

  /**
   * Wipes this device. Cloud sync is switched off as part of it, on purpose: a reset
   * that stayed connected would push the empty record over the only backup a few
   * seconds later. Reconnecting afterwards pulls the cloud copy back, which makes
   * "reset" recoverable and makes deleting the gist the deliberate act it should be.
   */
  async resetAll() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    await store.clearAll();
    this.secrets = { ...(await store.loadSecrets()), githubToken: null, gistId: null };
    await store.saveSecrets($state.snapshot(this.secrets));
    this.cloud = { status: 'off', lastSyncAt: null, lastDevice: null, error: null };
    this.progress = defaultProgress();
    this.weeks = [];
    this.applyTheme();
    await this.refresh();
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export const app = new AppStore();
