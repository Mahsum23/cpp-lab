/**
 * Cloud sync over a secret GitHub Gist.
 *
 * Why a gist, of all things: the app is a static site with no backend and no budget,
 * and `api.github.com` is one of the very few free APIs that sends
 * `Access-Control-Allow-Origin: *`, so a phone can PATCH it directly with no proxy in
 * the middle. A secret gist is a private, versioned, diffable JSON blob with an
 * account already attached — which is to say, exactly the shape of this problem.
 *
 * The token is a fine-grained PAT with a single permission: Gists, read and write. It
 * cannot read a repo, cannot push code, cannot open an issue, and is revocable from
 * one page. That's the trade for having no server: a narrow credential on the device
 * instead of a broad one on a machine you'd have to run.
 *
 * Considered and rejected:
 *  - Committing progress.json to the repo — needs `contents:write` (a far wider
 *    credential) and turns a learning log into commit-history noise.
 *  - Telegram's Bot API — also CORS-open, but a bot cannot read its own chat history,
 *    so "restore onto a wiped phone" has no clean path; and the bot token is a much
 *    broader capability than gists-only.
 */
import { SCHEMA_VERSION, type Progress } from './types';

const API = 'https://api.github.com';
const FILENAME = 'cpp-lab-progress.json';
const DESCRIPTION = 'cpp-lab — learning progress (written by the app; safe to delete, not to hand-edit)';

export interface CloudPayload {
  app: 'cpp-lab';
  schemaVersion: number;
  updatedAt: string;
  /** Which device wrote this last. Cosmetic — it makes the Settings line readable. */
  device: string;
  progress: Progress;
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Short, human name for the current device, for the "last synced from" line. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'a browser';
}

/** Turn GitHub's status codes into something worth reading on a phone. */
function explain(status: number, body: string): string {
  if (status === 401) {
    return 'GitHub rejected that token. It needs to be a fine-grained token with Gists: read and write — and it may simply have expired.';
  }
  if (status === 403 || status === 429) {
    return /rate limit/i.test(body)
      ? 'GitHub rate limit hit. It resets within the hour.'
      : "GitHub refused the request. The token is probably missing the Gists permission.";
  }
  if (status === 404) return 'That gist is gone. Disconnect and reconnect to make a new one.';
  if (status >= 500) return 'GitHub is having a moment. Try again shortly.';
  return `GitHub said ${status}.`;
}

async function gh(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new CloudError(
      navigator.onLine ? 'Could not reach GitHub.' : 'Offline — sync will catch up when you have signal.',
    );
  }
  if (!res.ok) throw new CloudError(explain(res.status, await res.text().catch(() => '')), res.status);
  return res.json();
}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}
interface Gist {
  id: string;
  html_url: string;
  updated_at: string;
  files: Record<string, GistFile>;
}

function envelope(progress: Progress): CloudPayload {
  return {
    app: 'cpp-lab',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    device: deviceName(),
    progress,
  };
}

const body = (progress: Progress) => ({
  files: { [FILENAME]: { content: `${JSON.stringify(envelope(progress), null, 2)}\n` } },
});

/**
 * Find this account's existing progress gist, if there is one. Matching on the
 * filename rather than the description so a gist stays findable after someone
 * renames it in the GitHub UI.
 *
 * One page is enough: GitHub returns gists newest-updated first, and this one is
 * rewritten every session, so it can't sink past the hundredth.
 */
export async function findGist(token: string): Promise<string | null> {
  const gists = (await gh(token, '/gists?per_page=100')) as Gist[];
  return gists.find((g) => g.files && FILENAME in g.files)?.id ?? null;
}

export async function createGist(token: string, progress: Progress): Promise<string> {
  const gist = (await gh(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: DESCRIPTION, public: false, ...body(progress) }),
  })) as Gist;
  return gist.id;
}

export async function push(token: string, gistId: string, progress: Progress): Promise<string> {
  const gist = (await gh(token, `/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify(body(progress)),
  })) as Gist;
  return gist.updated_at;
}

export async function pull(token: string, gistId: string): Promise<CloudPayload | null> {
  const gist = (await gh(token, `/gists/${gistId}`)) as Gist;
  const file = gist.files?.[FILENAME];
  if (!file) return null;

  // GitHub inlines file content only up to 1MB and sets `truncated` past that. Our
  // payload is a few KB, so this branch is insurance rather than a real path.
  let text = file.content;
  if ((file.truncated || text === undefined) && file.raw_url) {
    text = await (await fetch(file.raw_url)).text();
  }
  if (!text) return null;

  let parsed: CloudPayload;
  try {
    parsed = JSON.parse(text) as CloudPayload;
  } catch {
    throw new CloudError("The gist doesn't contain valid JSON any more — it's been hand-edited.");
  }
  if (parsed?.app !== 'cpp-lab' || !parsed.progress?.days) {
    throw new CloudError("That gist isn't a cpp-lab backup.");
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new CloudError('The cloud copy was written by a newer version of the app. Update this device first.');
  }
  return parsed;
}

export const gistUrl = (id: string) => `https://gist.github.com/${id}`;
