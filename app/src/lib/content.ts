import type { Curriculum, Week } from './types';
import { CONTENT_SCHEMA_VERSION } from './types';

const base = import.meta.env.BASE_URL;

/**
 * Curriculum JSON is served from the same origin as the shell — no CORS, no backend.
 *
 * The query string is there for the CDN, not the browser. GitHub Pages' edge keeps a
 * file for up to ten minutes after a deploy, and `cache: 'no-cache'` only revalidates
 * against that edge, not the origin. So for those minutes a freshly updated app read the
 * old list, decided nothing had changed, and kept showing content in the old shape. A
 * URL the edge has never seen goes to the origin. The service worker ignores the query
 * when it falls back to its offline copy, so offline still works.
 */
export async function fetchCurriculum(): Promise<Curriculum> {
  const res = await fetch(`${base}content/curriculum.json?t=${Date.now()}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`curriculum: HTTP ${res.status}`);
  const c = (await res.json()) as Curriculum;
  if (c.schemaVersion > CONTENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(
      `Content is schemaVersion ${c.schemaVersion}, this app understands ${CONTENT_SCHEMA_VERSION}.`,
    );
  }
  return c;
}

/** Keyed by the content hash the list announced, so an edge copy of an older version
 *  of the same file can never be the answer. */
export async function fetchWeek(url: string, contentHash: string): Promise<Week> {
  const res = await fetch(`${base}${url}?h=${encodeURIComponent(contentHash)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`week: HTTP ${res.status}`);
  return (await res.json()) as Week;
}

/** Thrown when the app shell is older than the content it was handed. */
export class SchemaTooNewError extends Error {}
