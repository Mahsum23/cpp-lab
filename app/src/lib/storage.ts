import { openDB, type IDBPDatabase } from 'idb';
import { defaultProgress, emptyDayProgress, SCHEMA_VERSION, type Progress, type Week } from './types';

const DB_NAME = 'cpp-lab';
const DB_VERSION = 1;
const KV = 'kv';
const WEEKS = 'weeks';
const PROGRESS_KEY = 'progress';

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
      if (!d.objectStoreNames.contains(WEEKS)) d.createObjectStore(WEEKS);
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

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear(KV);
  await d.clear(WEEKS);
}

/** Fill in fields added by later app versions rather than throwing away a real run. */
function migrate(p: Progress): Progress {
  const base = defaultProgress();
  const merged: Progress = {
    ...base,
    ...p,
    schemaVersion: SCHEMA_VERSION,
    streak: { ...base.streak, ...p.streak },
    settings: { ...base.settings, ...p.settings },
    badges: { ...p.badges },
    loadedWeeks: { ...p.loadedWeeks },
    days: {},
  };
  for (const [id, d] of Object.entries(p.days ?? {})) {
    merged.days[id] = { ...emptyDayProgress(d.weekId), ...d, quiz: { ...emptyDayProgress(d.weekId).quiz, ...d.quiz } };
  }
  return merged;
}
