/**
 * test-write.mjs — "write it" cards are judged by running what you typed in a real
 * PostgreSQL (PGlite) and comparing rows with the reference answer's. Two halves:
 *
 *  - the comparison rules (writecheck.ts): what counts as the same answer, in pure code;
 *  - the engine (sqlcore.ts) driven against every card the app ships: each reference
 *    solution has to run, return rows, be judged correct against itself, and give the same
 *    rows twice; and one card's query must not be able to leak into the next.
 *
 * If PG16_ANSWERS points at the JSON written by `tools/check-write-cards.py --dump`, the
 * in-browser engine's answers are also compared with a real PostgreSQL 16's, card by card.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cache = new URL('../node_modules/.cache/slowpath/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });
async function load(entry, name) {
  const outfile = join(cache, name);
  await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', outfile,
    external: ['@electric-sql/pglite'],
  });
  return import(outfile);
}

const { compareResults, isOrdered, normalize, cellText, forbiddenHit } = await load('../src/lib/writecheck.ts', 'writecheck.mjs');
const { createCore } = await load('../src/lib/sqlcore.ts', 'sqlcore.mjs');
const { PGlite } = await import('@electric-sql/pglite');

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};
const T = (columns, rows) => ({ columns, rows });

console.log('\n— what counts as the same answer —');
const want = T(['a', 'b'], [['1', 'x'], ['2', 'y'], ['2', 'y']]);
ok('same rows, different column names', compareResults(T(['p', 'q'], want.rows), want, false).ok);
ok('row order ignored when the answer is not ordered', compareResults(T(['a', 'b'], [['2', 'y'], ['1', 'x'], ['2', 'y']]), want, false).ok);
ok('row order matters when it is', compareResults(T(['a', 'b'], [['2', 'y'], ['1', 'x'], ['2', 'y']]), want, true).reason === 'order');
ok('a duplicate row is a different answer', compareResults(T(['a', 'b'], [['1', 'x'], ['2', 'y']]), want, false).reason === 'rows');
ok('a missing row is reported', compareResults(T(['a', 'b'], [['1', 'x'], ['2', 'y']]), want, false).missing.length === 1);
ok('an extra row is reported', compareResults(T(['a', 'b'], [...want.rows, ['3', 'z']]), want, false).extra.length === 1);
ok('the wrong number of columns is its own verdict', compareResults(T(['a'], [['1'], ['2'], ['2']]), want, false).reason === 'columns');
ok('120.00 and 120 are the same number', compareResults(T(['n'], [['120']]), T(['n'], [['120.00']]), false).ok);
ok('0.30000000000000004 is not 0.3', !compareResults(T(['n'], [['0.3']]), T(['n'], [['0.30000000000000004']]), false).ok);
ok('NULL is not the text "NULL"', !compareResults(T(['n'], [['NULL']]), T(['n'], [[null]]), false).ok);
ok('NULL equals NULL', compareResults(T(['n'], [[null]]), T(['n'], [[null]]), false).ok);
ok('"1" and "1.0" are the same, "01" is text', normalize('1.0') === normalize('1') && normalize('01') === '1');
ok('a long digit string does not collapse into another', normalize('12345678901234567890') !== normalize('12345678901234567891'));
ok('cellText: booleans print like psql, arrays like Postgres', cellText(true) === 't' && cellText([1, null, 3]) === '{1,NULL,3}');

console.log('\n— when row order is part of the answer —');
ok('a top-level ORDER BY', isOrdered('SELECT a FROM t ORDER BY a'));
ok('only the last statement counts', isOrdered('SELECT 1 ORDER BY 1; SELECT 2') === false);
ok('no ORDER BY, no order', !isOrdered('SELECT a FROM t'));
ok("a window's ORDER BY does not sort the result", !isOrdered('SELECT sum(a) OVER (ORDER BY b) FROM t'));
ok('a subquery\'s ORDER BY does not either', !isOrdered('SELECT * FROM (SELECT a FROM t ORDER BY a LIMIT 3) s'));
ok('the words in a string are not SQL', !isOrdered("SELECT 'order by' AS x"));
ok('but one after a window is', isOrdered('SELECT sum(a) OVER (ORDER BY b) FROM t ORDER BY 1'));

console.log('\n— cards about how a query is written —');
const noCast = [{ say: 'a cast on created_at', match: 'created_at\\s*::' }];
ok('a forbid catches the spelling the card is about', forbiddenHit('SELECT 1 FROM t WHERE created_at::date = $1', noCast) === 'a cast on created_at');
ok('…case-insensitively', forbiddenHit('select 1 from t where CREATED_AT :: date = 1', noCast) !== null);
ok('…and not in a comment', forbiddenHit('SELECT 1 FROM t -- not created_at::date\nWHERE created_at >= $1', noCast) === null);
ok('a broken pattern never fails the learner', forbiddenHit('SELECT 1', [{ say: 'x', match: '(' }]) === null);

console.log('\n— the engine, against every card the app ships —');
const weeksDir = new URL('../public/content/weeks/', import.meta.url).pathname;
const cards = [];
for (const f of readdirSync(weeksDir)) {
  for (const day of JSON.parse(readFileSync(join(weeksDir, f), 'utf8')).days) {
    // Go and C++ cards are judged by shape: test-shape.mjs and check-shape-cards.mjs.
    for (const set of [day.write, day.practice?.write]) {
      if (!set || (set.lang ?? 'sql') !== 'sql') continue;
      for (const c of set.challenges) cards.push({ day: day.id, setup: set.setup, ...c });
    }
  }
}
ok(`there are write cards to test (${cards.length})`, cards.length > 0);
for (const c of cards) if (c.forbids?.length) ok(`${c.day}/${c.id}: the reference answer passes its own forbids`, forbiddenHit(c.solution, c.forbids) === null);

const db = new PGlite();
await db.waitReady;
let reply = null;
const core = createCore(db, (r) => { reply = r; });
const go = async (job) => { reply = null; await core.handle({ id: 1, ...job }); return reply; };
const answer = (c, sql = c.solution) => go({ op: 'run', setup: c.setup, sql, verify: c.verify ?? undefined });

const mine = {};
for (const c of cards) {
  const label = `${c.day}/${c.id}`;
  const first = await answer(c);
  if (first.type !== 'run') { ok(`${label} runs`, false, `${first.stage}: ${first.message}`); continue; }
  const again = await answer(c);
  const ordered = c.ordered ?? isOrdered(c.verify ?? c.solution);
  const same = again.type === 'run' && compareResults(again.table, first.table, ordered).ok;
  const rows = first.table.rows.length;
  ok(`${label}: ${rows} row(s), judged correct against itself, same twice`, rows > 0 && same && compareResults(first.table, first.table, ordered).ok);
  const wrong = await answer(c, 'SELECT 1 AS nope');
  ok(`${label}: "SELECT 1" is not accepted`, wrong.type !== 'run' || !compareResults(wrong.table, first.table, ordered).ok);
  mine[`${c.day}:${c.id}`] = { columns: first.table.columns, rows: first.table.rows, ordered };
}

console.log('\n— errors, and what must not survive from one card to the next —');
const c0 = cards[0];
const syntax = await answer(c0, 'SELEC 1');
ok('a syntax error comes back as an error in the query stage', syntax.type === 'error' && syntax.stage === 'query' && /syntax error/.test(syntax.message), JSON.stringify(syntax));
const missing = await answer(c0, 'SELECT * FROM no_such_table');
ok('a missing table says so, in Postgres\'s words', missing.type === 'error' && /does not exist/.test(missing.message));
const badSetup = await go({ op: 'run', setup: 'CREATE TABLE', sql: 'SELECT 1' });
ok('a broken setup is reported as the card\'s fault, not yours', badSetup.type === 'error' && badSetup.stage === 'setup');
await answer(c0, 'CREATE SCHEMA other; CREATE TABLE other.t(a int); CREATE TABLE public.leak(a int); COMMIT; BEGIN');
const leak = await go({ op: 'run', setup: '', sql: "SELECT to_regclass('public.leak') IS NULL AS clean, (SELECT count(*) FROM pg_namespace WHERE nspname = 'other') AS schemas" });
ok('tables, schemas and open transactions do not leak into the next run', leak.type === 'run' && leak.table.rows[0][0] === 't' && leak.table.rows[0][1] === '0', JSON.stringify(leak.table));
const afterError = await answer(c0, 'BEGIN; SELECT 1/0');
const next = await answer(c0);
ok('an aborted transaction does not poison the next run', afterError.type === 'error' && next.type === 'run');
const tz = await go({ op: 'run', setup: '', sql: "SET timezone TO 'Asia/Tashkent'" });
const tz2 = await go({ op: 'run', setup: '', sql: 'SHOW timezone' });
ok('a changed time zone does not survive (every run is UTC)', tz2.type === 'run' && tz2.table.rows[0][0] === 'UTC', JSON.stringify(tz2.table));
const many = await go({ op: 'run', setup: '', sql: 'SELECT * FROM generate_series(1, 5000)' });
ok('a firehose is refused rather than shipped', many.type === 'error' && many.code === 'TOO_MANY_ROWS');

console.log('\n— drawing the card —');
const desc = await go({ op: 'describe', setup: cards.find((c) => c.day === 'sql-day-05').setup });
ok('the tables are read from the engine', desc.type === 'describe' && desc.tables.map((t) => t.name).join() === 'customers,orders');
ok('with their columns and types', desc.tables[1].columns.map((c) => `${c.name} ${c.type}`).join() === 'id integer,customer_id integer,status text,amount numeric');
ok('and their first rows', desc.tables[0].rowCount === 4 && desc.tables[0].rows[0].join() === '1,ana');

if (process.env.PG16_ANSWERS) {
  console.log('\n— against a real PostgreSQL 16 —');
  const real = JSON.parse(readFileSync(process.env.PG16_ANSWERS, 'utf8'));
  for (const [id, m] of Object.entries(mine)) {
    const r = real[id];
    if (!r) { ok(`${id} is in the PG16 dump`, false); continue; }
    const v = compareResults({ columns: m.columns, rows: m.rows }, r, m.ordered);
    ok(`${id}: the browser engine returns what PostgreSQL 16 returns`, v.ok, JSON.stringify(v).slice(0, 300));
  }
}

console.log(fails ? `\n  ${fails} FAILING` : '\n  all write-card cases pass');
await db.close();
process.exit(fails ? 1 : 0);
