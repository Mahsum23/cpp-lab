import { types, type PGlite } from '@electric-sql/pglite';
import { cellText, type Cell, type ResultTable } from './writecheck';

/** Every column comes back as the text Postgres would print, so 't' stays 't'. */
const PARSERS = Object.fromEntries(
  Object.values(types as Record<string, unknown>)
    .filter((v): v is number => typeof v === 'number')
    .map((oid) => [oid, (s: string) => s]),
);

/** More than this and a query is a firehose, not an answer. */
const MAX_ROWS = 1000;

export type Job =
  | { op: 'run'; id: number; setup: string; sql: string; verify?: string }
  | { op: 'describe'; id: number; setup: string };

export interface TableInfo {
  name: string;
  columns: { name: string; type: string }[];
  rows: Cell[][];
  rowCount: number;
}

export type Reply =
  | { type: 'ready' }
  | { type: 'boot-error'; message: string }
  | { type: 'run'; id: number; table: ResultTable; affected: number | null; ms: number }
  | { type: 'describe'; id: number; tables: TableInfo[] }
  | { type: 'error'; id: number; message: string; code?: string; stage: 'setup' | 'query' | 'verify' };

/**
 * The engine's behaviour, apart from where it runs. The worker wires it to messages; the
 * tests hand it a PGlite directly. Everything a card needs is here: a clean database per
 * run, the last result set as text, and the introspection that draws the card's tables.
 */
export function createCore(db: PGlite, send: (reply: Reply) => void) {
  /**
   * A clean database for every run. The same engine serves card after card, and a query
   * that said COMMIT, or created a table in another schema, or left a transaction open,
   * must not leak into the next one.
   */
  async function reset() {
    await db.exec('ROLLBACK').catch(() => {});
    await db.exec('RESET ALL');
    const stray = await db.exec(
      `SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema', 'public')`,
      { rowMode: 'array' },
    );
    for (const [name] of (stray.at(-1)?.rows ?? []) as unknown[][]) {
      await db.exec(`DROP SCHEMA "${String(name).replace(/"/g, '""')}" CASCADE`).catch(() => {});
    }
    await db.exec(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; SET timezone TO 'UTC'`);
  }

  /** The last statement that returned rows. A script's answer is its last result set. */
  async function runScript(sql: string): Promise<{ table: ResultTable; affected: number | null }> {
    const results = await db.exec(sql, { rowMode: 'array', parsers: PARSERS });
    const withRows = [...results].reverse().find((r) => r.fields.length > 0);
    if (!withRows) {
      return { table: { columns: [], rows: [] }, affected: results.at(-1)?.affectedRows ?? null };
    }
    if (withRows.rows.length > MAX_ROWS) {
      throw Object.assign(new Error(`That query returned more than ${MAX_ROWS} rows. Narrow it down.`), { code: 'TOO_MANY_ROWS' });
    }
    return {
      table: {
        columns: withRows.fields.map((f) => f.name),
        rows: (withRows.rows as unknown[][]).map((row) => row.map((v) => cellText(v))),
      },
      affected: null,
    };
  }

  const failure = (err: unknown) => {
    const e = err as { message?: string; code?: string };
    return { message: e?.message ?? String(err), code: e?.code };
  };

  async function run(job: Extract<Job, { op: 'run' }>) {
    const started = performance.now();
    await reset();
    try {
      await db.exec(job.setup);
    } catch (err) {
      return send({ type: 'error', id: job.id, stage: 'setup', ...failure(err) });
    }
    let result: Awaited<ReturnType<typeof runScript>>;
    try {
      result = await runScript(job.sql);
    } catch (err) {
      // A failed statement can leave an open transaction in an aborted state; verify must
      // not be handed that, and neither must the next card.
      await db.exec('ROLLBACK').catch(() => {});
      return send({ type: 'error', id: job.id, stage: 'query', ...failure(err) });
    }
    if (job.verify) {
      try {
        result = await runScript(job.verify);
      } catch (err) {
        return send({ type: 'error', id: job.id, stage: 'verify', ...failure(err) });
      }
    }
    send({ type: 'run', id: job.id, ...result, ms: Math.round(performance.now() - started) });
  }

  /** What the card's tables look like, from the engine itself rather than from a copy. */
  async function describe(job: Extract<Job, { op: 'describe' }>) {
    await reset();
    try {
      await db.exec(job.setup);
      const cols = (
        await db.exec(
          `SELECT table_name, column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
          { rowMode: 'array', parsers: PARSERS },
        )
      ).at(-1)!.rows as string[][];
      const names = [...new Set(cols.map((c) => c[0]))];
      const tables: TableInfo[] = [];
      for (const name of names) {
        const q = `"${name.replace(/"/g, '""')}"`;
        const count = Number(
          ((await db.exec(`SELECT count(*) FROM ${q}`, { rowMode: 'array', parsers: PARSERS })).at(-1)!.rows[0] as string[])[0],
        );
        const data = (
          await db.exec(`SELECT * FROM ${q} LIMIT 8`, { rowMode: 'array', parsers: PARSERS })
        ).at(-1)!.rows as unknown[][];
        tables.push({
          name,
          columns: cols.filter((c) => c[0] === name).map((c) => ({ name: c[1], type: c[2] })),
          rows: data.map((r) => r.map((v) => cellText(v))),
          rowCount: count,
        });
      }
      send({ type: 'describe', id: job.id, tables });
    } catch (err) {
      send({ type: 'error', id: job.id, stage: 'setup', ...failure(err) });
    }
  }

  return {
    handle(job: Job): Promise<void> {
      return job.op === 'run' ? run(job) : describe(job);
    },
  };
}
