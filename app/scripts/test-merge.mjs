/**
 * test-merge.mjs — two devices, no server, and a merge function that has to be right
 * the first time. A bad merge here doesn't throw; it quietly eats a session he did.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/merge.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-merge.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { mergeProgress, mergeStreak } = await import(file);

let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const day = (over = {}) => ({
  weekId: 'week-01',
  theoryDone: false,
  quiz: { answers: {}, correct: {}, completedAt: null, cleanSweep: false },
  task: 'todo',
  checklist: [],
  notes: '',
  teachBackDone: false,
  completedAt: null,
  ...over,
});

const base = (over = {}) => ({
  schemaVersion: 1,
  days: {},
  streak: { count: 0, longest: 0, lastActiveDate: null, freezes: 0, freezesEarnedAt: 0 },
  xp: 0,
  badges: {},
  settings: { theme: 'dark', peekAhead: false, mentorModel: 'claude-sonnet-5' },
  loadedWeeks: {},
  ...over,
});

// --- the case the whole feature exists for ---------------------------------

const phone = base({ days: { 'day-01': day({ completedAt: '2026-09-01T18:00:00Z', theoryDone: true, task: 'done' }) } });
const laptop = base({ days: { 'day-02': day({ completedAt: '2026-09-02T09:00:00Z', theoryDone: true, task: 'done' }) } });
const both = mergeProgress(phone, laptop);
ok('a day done only on the phone survives', Boolean(both.days['day-01'].completedAt));
ok('a day done only on the laptop survives', Boolean(both.days['day-02'].completedAt));
ok('XP is derived from the union, not summed or maxed', both.xp === 80);

// Same day, both sides, different amounts of work done on each.
const a = base({ days: { 'day-01': day({ theoryDone: true, checklist: [true, false, false], notes: 'errno confused me' }) } });
const b = base({ days: { 'day-01': day({ task: 'done', checklist: [false, true, false], notes: '' }) } });
const m = mergeProgress(a, b);
ok('field-wise merge keeps theory from one side', m.days['day-01'].theoryDone);
ok('field-wise merge keeps task state from the other', m.days['day-01'].task === 'done');
ok('checklist is a union, item by item', JSON.stringify(m.days['day-01'].checklist) === '[true,true,false]');
ok('a note survives against an empty one', m.days['day-01'].notes === 'errno confused me');

const notes = mergeProgress(
  base({ days: { 'day-01': day({ notes: 'from the phone' }) } }),
  base({ days: { 'day-01': day({ notes: 'from the laptop' }) } }),
);
ok('two different notes are both kept', /from the phone[\s\S]*from the laptop/.test(notes.days['day-01'].notes));

// Answers and their verdicts must not come from different records.
const q = mergeProgress(
  base({ days: { 'day-01': day({ quiz: { answers: { q1: 2 }, correct: { q1: true }, completedAt: null, cleanSweep: false } }) } }),
  base({ days: { 'day-01': day({ quiz: { answers: { q1: 0, q2: 1 }, correct: { q1: false, q2: true }, completedAt: null, cleanSweep: false } }) } }),
);
ok('local answer wins and carries its own verdict', q.days['day-01'].quiz.answers.q1 === 2 && q.days['day-01'].quiz.correct.q1 === true);
ok('a question only the remote answered is kept', q.days['day-01'].quiz.answers.q2 === 1);

// --- idempotence: sync runs on every foreground ----------------------------

const once = mergeProgress(phone, laptop);
const twice = mergeProgress(once, laptop);
ok('merging twice changes nothing', JSON.stringify(once) === JSON.stringify(twice));
ok('merge is symmetric for day data', JSON.stringify(Object.keys(mergeProgress(laptop, phone).days).sort()) === JSON.stringify(['day-01', 'day-02']));

// --- streaks: the field that cannot be merged, only chosen -----------------

const stale = { count: 12, longest: 12, lastActiveDate: '2026-08-20', freezes: 2, freezesEarnedAt: 7 };
const current = { count: 1, longest: 12, lastActiveDate: '2026-09-02', freezes: 0, freezesEarnedAt: 14 };
const s = mergeStreak(current, stale);
ok('a drawer phone cannot resurrect a broken streak', s.count === 1);
ok('longest is a high-water mark and takes the max', s.longest === 12);
ok('the freeze bank comes from the record that acted last', s.freezes === 0);
ok('freezesEarnedAt is monotonic', s.freezesEarnedAt === 14);
const tie = mergeStreak({ ...current, count: 3 }, { ...current, count: 5 });
ok('same-day tie takes the larger count', tie.count === 5);

// --- the two fields that stay local ----------------------------------------

const local = mergeProgress(
  base({ settings: { theme: 'dark', peekAhead: false, mentorModel: 'claude-sonnet-5' }, loadedWeeks: {} }),
  base({ settings: { theme: 'light', peekAhead: true, mentorModel: 'claude-opus-5' }, loadedWeeks: { 'week-01': { contentHash: 'x', loadedAt: 'y' } } }),
);
ok('settings are per-device and not synced', local.settings.theme === 'dark' && local.settings.peekAhead === false);
ok('loadedWeeks stays local so a fresh install still downloads', Object.keys(local.loadedWeeks).length === 0);

// --- badges ----------------------------------------------------------------

const badges = mergeProgress(
  base({ badges: { 'first-socket': '2026-09-02T00:00:00Z' } }),
  base({ badges: { 'first-socket': '2026-09-01T00:00:00Z', 'clean-sweep': '2026-09-01T00:00:00Z' } }),
);
ok('a badge keeps its earliest earn time', badges.badges['first-socket'] === '2026-09-01T00:00:00Z');
ok('badges from both sides are kept', 'clean-sweep' in badges.badges);

console.log(fails ? `\n  ${fails} FAILING` : '\n  all merge cases pass');
process.exit(fails ? 1 : 0);
