/**
 * Deciding whether the query you wrote did what was asked, from the rows it returned.
 *
 * A "write it" card is judged by what your query *produces*, not by how it is spelled:
 * `NOT EXISTS` and `LEFT JOIN … IS NULL` are both right for the same question, and a
 * grader that compared text would mark one of them wrong. So both queries are run and
 * their result tables compared. That is the only honest way to grade SQL without a model,
 * and it needs no network and no key.
 *
 * Pure on purpose — no engine, no DOM — so every rule below is tested in node.
 */

export type Cell = string | null;

/** What a query returned: column names and every value as text, the way psql shows them. */
export interface ResultTable {
  columns: string[];
  rows: Cell[][];
}

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'columns'; got: number; want: number }
  | { ok: false; reason: 'rows'; missing: Cell[][]; extra: Cell[][] }
  | { ok: false; reason: 'order' };

/**
 * Whether row order is part of the answer.
 *
 * It is when the reference query sorts at the top level: "the three highest scores, best
 * first" is wrong if it comes back worst first. An `ORDER BY` inside parentheses — a
 * window's `OVER (ORDER BY …)`, a subquery — orders something else, and does not count.
 * Without a top-level `ORDER BY` the database promises no order at all (day 7 of the
 * SQL track is about exactly that), so demanding one would grade luck.
 */
export function isOrdered(sql: string): boolean {
  const last = lastStatement(sql);
  let depth = 0;
  let out = '';
  for (let i = 0; i < last.length; i++) {
    const c = last[i];
    if (c === "'") {
      // Skip a string literal whole: its contents are text, not SQL.
      i++;
      while (i < last.length && !(last[i] === "'" && last[i + 1] !== "'")) i += last[i] === "'" ? 2 : 1;
      out += ' ';
    } else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return /\border\s+by\b/i.test(out.replace(/--[^\n]*/g, ' '));
}

/** The last statement of a script — the one whose rows are the answer. */
function lastStatement(sql: string): string {
  const parts = sql
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.at(-1) ?? '';
}

/**
 * One cell, in the form two cells are compared in.
 *
 * Numbers are compared by value, so `120.00` and `120` agree (a scale a learner didn't
 * choose is not the thing being tested) — but only when they are exactly the same number.
 * `0.30000000000000004` is not `0.3`, and a card about floating point has to be able to
 * tell them apart.
 */
export function normalize(cell: Cell): string {
  if (cell === null) return '\u0000null';
  if (/^-?\d+(\.\d+)?$/.test(cell)) {
    const n = Number(cell);
    // Beyond what a double holds exactly, fall back to the text rather than let two
    // different huge numbers collapse into one.
    if (Number.isFinite(n) && Math.abs(n) < 2 ** 53) return String(n);
  }
  return cell;
}

const keyOf = (row: Cell[]) => JSON.stringify(row.map(normalize));

/**
 * Compare your result with the reference.
 *
 * Column *names* are ignored — `AS total` against `AS sum` is a style choice — but the
 * number of columns is not, and neither are the values. Rows are compared as a multiset
 * (so duplicates matter) unless the answer is ordered.
 */
export function compareResults(got: ResultTable, want: ResultTable, ordered: boolean): Verdict {
  if (want.columns.length && got.columns.length !== want.columns.length) {
    return { ok: false, reason: 'columns', got: got.columns.length, want: want.columns.length };
  }

  const left = new Map<string, { row: Cell[]; n: number }>();
  for (const row of want.rows) {
    const k = keyOf(row);
    const e = left.get(k);
    if (e) e.n++;
    else left.set(k, { row, n: 1 });
  }
  const extra: Cell[][] = [];
  for (const row of got.rows) {
    const e = left.get(keyOf(row));
    if (e && e.n > 0) e.n--;
    else extra.push(row);
  }
  const missing: Cell[][] = [];
  for (const { row, n } of left.values()) for (let i = 0; i < n; i++) missing.push(row);

  if (missing.length || extra.length) return { ok: false, reason: 'rows', missing, extra };

  if (ordered) {
    for (let i = 0; i < want.rows.length; i++) {
      if (keyOf(got.rows[i]) !== keyOf(want.rows[i])) return { ok: false, reason: 'order' };
    }
  }
  return { ok: true };
}

/** A value the way psql would print it. Everything the engine hands over passes through here. */
export function cellText(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'bigint' || typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return `{${v.map((x) => cellText(x) ?? 'NULL').join(',')}}`;
  return JSON.stringify(v);
}

/**
 * The first thing the card rules out that this query does, or null.
 *
 * Some cards are about *how* a query is written, not only what it returns: "rewrite this
 * so the index on created_at can be used" has the same rows either way, and the rows alone
 * would pass the very query the card is about. Those cards carry `forbids` — regular
 * expressions over the query text, matched case-insensitively, comments ignored — and
 * check-write-cards.py proves the reference answer passes them and the classic wrong
 * answer does not.
 */
export function forbiddenHit(sql: string, forbids: { say: string; match: string }[] | undefined): string | null {
  const text = sql.replace(/--[^\n]*/g, ' ');
  for (const f of forbids ?? []) {
    try {
      if (new RegExp(f.match, 'i').test(text)) return f.say;
    } catch {
      // A broken pattern is the card's bug; it must not fail the learner.
    }
  }
  return null;
}
