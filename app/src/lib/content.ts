import type { Curriculum, Week } from './types';
import { SCHEMA_VERSION } from './types';

const base = import.meta.env.BASE_URL;

/** Curriculum JSON is served from the same origin as the shell — no CORS, no backend. */
export async function fetchCurriculum(): Promise<Curriculum> {
  const res = await fetch(`${base}content/curriculum.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`curriculum: HTTP ${res.status}`);
  const c = (await res.json()) as Curriculum;
  if (c.schemaVersion > SCHEMA_VERSION) {
    throw new SchemaTooNewError(
      `Content is schemaVersion ${c.schemaVersion}, this app understands ${SCHEMA_VERSION}.`,
    );
  }
  return c;
}

export async function fetchWeek(url: string): Promise<Week> {
  const res = await fetch(`${base}${url}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`week: HTTP ${res.status}`);
  return (await res.json()) as Week;
}

/** Thrown when the app shell is older than the content it was handed. */
export class SchemaTooNewError extends Error {}
