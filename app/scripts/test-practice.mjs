/**
 * test-practice.mjs — practice rounds (practice.ts): fresh items first, the mix, the bar
 * that lands a concept, merging two devices, and that practice keeps the streak alive.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const cache = new URL('../node_modules/.cache/slowpath/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });
async function load(entry, name) {
  const outfile = join(cache, name);
  await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile });
  return import(outfile);
}
const P = await load('../src/lib/practice.ts', 'practice.mjs');
const { cardsFor } = await load('../src/lib/review.ts', 'review-p.mjs');
const { deriveStreak } = await load('../src/lib/streak.ts', 'streak-p.mjs');

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};
let seed = 7;
const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const step = (id) => ({ id, kind: 'predict', code: null, prompt: id, options: [] });
const day = {
  id: 'sql-day-02',
  practice: {
    write: { lang: 'sql', setup: '', defs: {}, challenges: Array.from({ length: 21 }, (_, i) => ({ id: `w${i}` })) },
    drill: Array.from({ length: 9 }, (_, i) => step(`d${i}`)),
  },
};
const empty = P.emptyPractice();

console.log('— a round —');
const r1 = P.buildRound(day, empty, rng);
ok('a round is ROUND_SIZE items', r1.length === P.ROUND_SIZE);
ok('mostly writing: 7 written, 3 quick', r1.filter((c) => c.kind === 'write').length === 7 && r1.filter((c) => c.kind === 'drill').length === 3);
ok('no item twice', new Set(r1.map((c) => c.id)).size === r1.length);
ok('quick items are spread out, never two in a row', r1.every((c, i) => !(c.kind === 'drill' && r1[i + 1]?.kind === 'drill')));
ok('card ids are the deck\'s', r1.every((c) => c.id === `${c.kind}:sql-day-02:${c.questionId}`));

let st = empty;
for (const c of r1) st = P.recordFirst(st, c, true);
const r2 = P.buildRound(day, st, rng);
ok('the next round is all fresh while fresh items remain', r2.every((c) => !(P.itemKey(c) in st.first)));
ok('a first attempt is never overwritten', P.recordFirst(P.recordFirst(empty, r1[0], false), r1[0], true).first[P.itemKey(r1[0])] === false);

// See everything; miss three.
let all = empty;
const bank = P.bankCards(day);
bank.forEach((c, i) => { all = P.recordFirst(all, c, i >= 3); });
const r3 = P.buildRound(day, all, rng);
ok('once the bank is seen, missed items come first', bank.slice(0, 3).every((c) => r3.some((x) => x.id === c.id)));
ok('…and the round is still full', r3.length === P.ROUND_SIZE);
const status = P.practiceStatus(day, all);
ok('status counts fresh, missed and total', status.total === 30 && status.fresh === 0 && status.missed === 3);

const small = { id: 'x', practice: { write: null, drill: [step('a'), step('b')] } };
ok('a bank smaller than a round deals what it has', P.buildRound(small, empty, rng).length === 2);
const writesOnly = { id: 'y', practice: { write: { lang: 'sql', setup: '', defs: {}, challenges: Array.from({ length: 12 }, (_, i) => ({ id: `w${i}` })) }, drill: [] } };
ok('a bank with no quick items fills the round with writing', P.buildRound(writesOnly, empty, rng).length === P.ROUND_SIZE);

console.log('\n— landing —');
ok('8 of 10 lands it', P.finishRound(empty, 10, 8, '2026-10-03T10:00:00Z').landedAt === '2026-10-03T10:00:00Z');
ok('7 of 10 does not', P.finishRound(empty, 10, 7).landedAt === null);
ok('4 of 4 is too short to count', P.finishRound(empty, 4, 4).landedAt === null);
const landed = P.finishRound(empty, 10, 9, '2026-10-03T10:00:00Z');
ok('a worse round later does not un-land it', P.finishRound(landed, 10, 2).landedAt === '2026-10-03T10:00:00Z');
ok('needsPractice: a bank that has not landed holds the next lesson', P.needsPractice(day, empty) && !P.needsPractice(day, landed));
ok('…"move on anyway" releases it', !P.needsPractice(day, { ...empty, movedOn: true }));
ok('…and a day without a bank never holds anything', !P.needsPractice({ id: 'z' }, undefined));

console.log('\n— two devices —');
const a = { first: { 'write:w1': true, 'write:w2': true }, rounds: [{ at: '2026-10-03T10:00:00Z', asked: 10, right: 6 }], landedAt: null, movedOn: false };
const b = { first: { 'write:w2': false, 'drill:d1': true }, rounds: [{ at: '2026-10-04T10:00:00Z', asked: 10, right: 9 }], landedAt: '2026-10-04T10:00:00Z', movedOn: false };
const m = P.mergePractice(a, b);
ok('first attempts are unioned', Object.keys(m.first).length === 3);
ok('a disagreement keeps the miss', m.first['write:w2'] === false);
ok('rounds from both, in order', m.rounds.length === 2 && m.rounds[0].at < m.rounds[1].at);
ok('landed if either landed', m.landedAt === '2026-10-04T10:00:00Z');
ok('one side missing is the other', P.mergePractice(undefined, b) === b);

console.log('\n— the deck grows with practice —');
const prog = { theoryDone: true, quiz: { correct: {} }, drill: { correct: {} }, practice: { first: { 'write:w0': true, 'drill:d0': false }, rounds: [], landedAt: null, movedOn: false } };
const deck = cardsFor(day, prog, 'sql');
ok('items a round dealt are review cards', deck.some((c) => c.id === 'write:sql-day-02:w0') && deck.some((c) => c.id === 'drill:sql-day-02:d0'));
ok('items not yet dealt are not', !deck.some((c) => c.id === 'write:sql-day-02:w1'));
const own = cardsFor({ id: 'd', drill: [step('s1'), step('s2')] }, { theoryDone: false, quiz: { correct: {} }, drill: { correct: { s1: true } } }, 'sql');
ok("the day's own answered drill steps are review cards too", own.some((c) => c.id === 'drill:d:s1') && !own.some((c) => c.id === 'drill:d:s2'));

console.log('\n— the streak —');
const days = [
  { completedAt: '2026-10-01T09:00:00', practice: { rounds: [] } },
  { completedAt: null, practice: { rounds: [{ at: '2026-10-02T09:00:00' }, { at: '2026-10-03T09:00:00' }] } },
];
ok('a practice round keeps the streak going like a lesson does', deriveStreak(days).count === 3);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
