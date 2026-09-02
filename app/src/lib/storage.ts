import { openDB, type IDBPDatabase } from 'idb';
import {
  defaultProgress,
  emptySecrets,
  emptyDayProgress,
  SCHEMA_VERSION,
  type Progress,
  type Secrets,
  type Week,
} from './types';

const DB_NAME = 'cpp-lab';
const DB_VERSION = 2;
const KV = 'kv';
const WEEKS = 'weeks';
const CHATS = 'chats';
const PROGRESS_KEY = 'progress';
const SECRETS_KEY = 'secrets';

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    // Guarded rather than versioned-switched: the same code has to bring a fresh
    // install and a v1 install to the same place.
    upgrade(d) {
      if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
      if (!d.objectStoreNames.contains(WEEKS)) d.createObjectStore(WEEKS);
      if (!d.objectStoreNames.contains(CHATS)) d.createObjectStore(CHATS);
    },
  });
  return dbp;
}

/**
 * iOS evicts script-writable storage from web apps it considers idle. Asking for
 * persistence is the only lever we have, and it costs nothing when refused — which
 * is exactly why Settings ships an export button rather than trusting this.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function loadProgress(): Promise<Progress> {
  try {
    const stored = (await (await db()).get(KV, PROGRESS_KEY)) as Progress | undefined;
    return stored ? migrate(stored) : defaultProgress();
  } catch (err) {
    console.error('[storage] progress load failed, starting fresh', err);
    return defaultProgress();
  }
}

/** Callers must pass a plain object — a Svelte state proxy is not structured-cloneable. */
export async function saveProgress(p: Progress): Promise<void> {
  try {
    await (await db()).put(KV, p, PROGRESS_KEY);
  } catch (err) {
    console.error('[storage] progress save failed', err);
  }
}

/**
 * Secrets are stored beside progress but never inside it — see the note on `Secrets`.
 * IndexedDB is origin-scoped and no worse than localStorage here; the real protection
 * is that the GitHub token is gists-only and the whole thing is revocable in one click.
 */
export async function loadSecrets(): Promise<Secrets> {
  try {
    const stored = (await (await db()).get(KV, SECRETS_KEY)) as Partial<Secrets> | undefined;
    return { ...emptySecrets(), ...stored };
  } catch {
    return emptySecrets();
  }
}

export async function saveSecrets(s: Secrets): Promise<void> {
  try {
    await (await db()).put(KV, s, SECRETS_KEY);
  } catch (err) {
    console.error('[storage] secrets save failed', err);
  }
}

export async function loadChat<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get(CHATS, key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function saveChat(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put(CHATS, value, key);
  } catch (err) {
    console.error('[storage] chat save failed', err);
  }
}

export async function deleteChat(key: string): Promise<void> {
  try {
    await (await db()).delete(CHATS, key);
  } catch {
    /* nothing to clean up */
  }
}

export async function loadWeek(id: string): Promise<Week | undefined> {
  try {
    return (await (await db()).get(WEEKS, id)) as Week | undefined;
  } catch {
    return undefined;
  }
}

export async function loadAllWeeks(): Promise<Week[]> {
  try {
    const all = (await (await db()).getAll(WEEKS)) as Week[];
    return all.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export async function saveWeek(week: Week): Promise<void> {
  try {
    await (await db()).put(WEEKS, week, week.id);
  } catch (err) {
    console.error('[storage] week save failed', err);
  }
}

/** Wipes progress and content. Secrets survive — re-pasting two API keys after a
 *  reset is pure friction, and "reset progress" doesn't mean "log me out". */
export async function clearAll(): Promise<void> {
  const d = await db();
  const secrets = await loadSecrets();
  await d.clear(KV);
  await d.clear(WEEKS);
  await d.clear(CHATS);
  await saveSecrets(secrets);
}

/**
 * The mentor gained a provider setting after the fact. A record that predates it has
 * a Claude model id and no provider, and defaulting it to Gemini would silently point
 * an Anthropic model at Google's API — so the model id is the evidence of intent.
 */
function migrateSettings(base: Progress['settings'], stored?: Partial<Progress['settings']>): Progress['settings'] {
  const merged = { ...base, ...stored };
  if (!stored?.mentorProvider && stored?.mentorModel?.startsWith('claude')) {
    merged.mentorProvider = 'anthropic';
  }
  return merged;
}

/** Fill in fields added by later app versions rather than throwing away a real run. */
function migrate(p: Progress): Progress {
  const base = defaultProgress();
  const merged: Progress = {
    ...base,
    ...p,
    schemaVersion: SCHEMA_VERSION,
    streak: { ...base.streak, ...p.streak },
    settings: migrateSettings(base.settings, p.settings),
    badges: { ...p.badges },
    loadedWeeks: { ...p.loadedWeeks },
    days: {},
  };
  for (const [id, d] of Object.entries(p.days ?? {})) {
    const blank = emptyDayProgress(d.weekId);
    const day = { ...blank, ...d, quiz: { ...blank.quiz, ...d.quiz } };

    // Records written before `quiz.correct` existed only know their answers as
    // indices into content that may since have been reshuffled. A clean sweep is
    // still unambiguous, though — every answer was right — so that much is
    // recoverable rather than guessed.
    if (Object.keys(day.quiz.correct).length === 0 && day.quiz.cleanSweep) {
      for (const qid of Object.keys(day.quiz.answers)) day.quiz.correct[qid] = true;
    }
    merged.days[id] = day;
  }
  return merged;
}
