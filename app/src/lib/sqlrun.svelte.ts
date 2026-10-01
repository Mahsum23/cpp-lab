/**
 * The page's handle on the in-browser Postgres (see sqlrun.worker.ts).
 *
 * The engine is about 5 MB over the wire, so it is fetched only once a "write it" card
 * is actually going to be dealt, and the browser keeps it afterwards — the service worker
 * caches it on first use, so after that it works with no network at all.
 *
 * Jobs run one at a time. A job that has not finished in `RUN_MS` is a query that will
 * never finish (an unterminated recursive CTE, `generate_series` to a billion), and the
 * engine cannot be interrupted, so the worker is thrown away and a new one is started.
 * The caller gets a plain "took too long" back and the next card is none the wiser.
 */
import type { Job, Reply, TableInfo } from './sqlcore';
import type { ResultTable } from './writecheck';

export type EngineState = 'idle' | 'booting' | 'ready' | 'failed';

export type RunResult =
  | { ok: true; table: ResultTable; affected: number | null; ms: number }
  | { ok: false; error: string; code?: string; stage: 'setup' | 'query' | 'verify' | 'timeout' | 'engine' };

/** How long a query may run before it is given up on. */
export const RUN_MS = 6000;

/**
 * How long the engine may take to start. Generous, because the first time it is a ~5 MB
 * download on whatever connection the phone has; but finite, because a start that never
 * finishes (out of memory, a stalled fetch) must end in "not available", not in a card
 * that says "starting" until you close the app.
 */
export const BOOT_MS = 90_000;

type Pending = { resolve: (r: Reply | { type: 'timeout' }) => void; timer: ReturnType<typeof setTimeout> };

class SqlEngine {
  state = $state<EngineState>('idle');
  /** Why it failed to start, in words. */
  problem = $state<string | null>(null);

  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  /** Start fetching and booting the engine, if it is not already. Safe to call often. */
  warm(): Promise<boolean> {
    if (this.ready && this.state !== 'failed') return this.ready;
    this.state = 'booting';
    this.problem = null;
    this.ready = new Promise<boolean>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./sqlrun.worker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        this.fail(err instanceof Error ? err.message : String(err));
        return resolve(false);
      }
      this.worker = worker;
      const giveUp = setTimeout(() => {
        if (this.state === 'booting' && this.worker === worker) {
          this.fail('The SQL engine did not start. Is there enough free memory, and a connection?');
          resolve(false);
        }
      }, BOOT_MS);
      worker.onmessage = (e: MessageEvent<Reply>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          clearTimeout(giveUp);
          this.state = 'ready';
          return resolve(true);
        }
        if (msg.type === 'boot-error') {
          this.fail(msg.message);
          return resolve(false);
        }
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
      };
      // A worker that fails to load (offline, and never cached) reports here, not above.
      worker.onerror = (e) => {
        this.fail(e.message || 'The SQL engine could not be loaded.');
        resolve(false);
      };
    });
    return this.ready;
  }

  /**
   * Let go of the engine: a PostgreSQL in WebAssembly holds a lot of memory, and nothing
   * outside the review deck wants it. Starting it again is a few seconds, from cache.
   */
  release() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.state = 'idle';
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ type: 'timeout' });
    }
    this.pending.clear();
  }

  private fail(message: string) {
    this.state = 'failed';
    this.problem = message;
    this.worker?.terminate();
    this.worker = null;
  }

  /** Throw the worker away — it is stuck — and start a fresh one for whatever comes next. */
  private recycle() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ type: 'timeout' });
    }
    this.pending.clear();
    void this.warm();
  }

  private send(job: Omit<Job, 'id'>): Promise<Reply | { type: 'timeout' }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Only the one that is actually stuck is recycled; everything behind it waits.
        if (this.pending.has(id)) this.recycle();
      }, RUN_MS);
      this.pending.set(id, { resolve, timer });
      this.worker!.postMessage({ ...job, id } as Job);
    });
  }

  /** Run a script against a fresh database that `setup` has just filled. */
  run(job: { setup: string; sql: string; verify?: string }): Promise<RunResult> {
    return this.enqueue(async () => {
      if (!(await this.warm())) return this.unavailable();
      const reply = await this.send({ op: 'run', ...job });
      if (reply.type === 'timeout') {
        return { ok: false, error: 'That query ran for too long and was stopped.', stage: 'timeout' } as const;
      }
      if (reply.type === 'error') return { ok: false, error: reply.message, code: reply.code, stage: reply.stage } as const;
      if (reply.type === 'run') return { ok: true, table: reply.table, affected: reply.affected, ms: reply.ms } as const;
      return this.unavailable();
    });
  }

  /** The card's tables as the engine sees them, with their first rows. */
  describe(setup: string): Promise<TableInfo[] | null> {
    return this.enqueue(async () => {
      if (!(await this.warm())) return null;
      const reply = await this.send({ op: 'describe', setup });
      return reply.type === 'describe' ? reply.tables : null;
    });
  }

  private unavailable(): RunResult {
    return { ok: false, error: this.problem ?? 'The SQL engine is not available.', stage: 'engine' };
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => {});
    return next;
  }
}

export const sql = new SqlEngine();
