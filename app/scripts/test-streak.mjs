/**
 * test-streak.mjs — the streak rules are the one piece of non-obvious pure logic in
 * the app (freezes, gaps, DST-proof date maths), and they're invisible until a real
 * run breaks. Node's own runner, no test framework, no new dependencies.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/streak.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-streak.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { completeDay, displayedStreak, atRisk } = await import(file);

let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const fresh = { count: 0, longest: 0, lastActiveDate: null, freezes: 0, freezesEarnedAt: 0 };

let s = completeDay(fresh, '2026-09-01');
ok('first session starts a streak of 1', s.streak.count === 1 && s.event === 'first');

s = completeDay(s.streak, '2026-09-02');
ok('next day extends to 2', s.streak.count === 2 && s.event === 'extended');

const same = completeDay(s.streak, '2026-09-02');
ok('a second session the same day changes nothing', same.event === 'already-today' && same.streak.count === 2);

// Run to 7 to earn a freeze.
let run = { streak: fresh };
for (let d = 1; d <= 7; d++) run = completeDay(run.streak, `2026-09-0${d}`);
ok('day 7 earns exactly one freeze', run.streak.freezes === 1 && run.freezeEarned);
ok('longest tracks the run', run.streak.longest === 7);

// Miss one day; the freeze absorbs it.
const frozen = completeDay(run.streak, '2026-09-09');
ok('one missed day spends the freeze and keeps the run', frozen.event === 'frozen' && frozen.streak.count === 8);
ok('the freeze is gone afterwards', frozen.streak.freezes === 0);

// Miss two days with no freeze banked.
const broken = completeDay(frozen.streak, '2026-09-13');
ok('a longer gap resets to 1', broken.event === 'reset' && broken.streak.count === 1);
ok('reset preserves longest', broken.streak.longest === 8);

// Missing a day with no freeze also resets.
const noFreeze = completeDay({ ...fresh, count: 3, lastActiveDate: '2026-09-01' }, '2026-09-03');
ok('gap of 2 with no freeze resets', noFreeze.event === 'reset' && noFreeze.streak.count === 1);

// Freezes cap at 2 rather than accumulating forever.
let long = { streak: fresh };
for (let d = 1; d <= 28; d++) long = completeDay(long.streak, new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10));
ok('freezes cap at 2 over a 28-day run', long.streak.freezes === 2);
ok('28-day run counted correctly', long.streak.count === 28);

// Display: a stale streak reads as 0 without mutating anything.
ok('yesterday keeps showing the run', displayedStreak({ ...fresh, count: 5, lastActiveDate: '2026-09-01' }, '2026-09-02') === 5);
ok('three days ago reads as cold', displayedStreak({ ...fresh, count: 5, lastActiveDate: '2026-09-01' }, '2026-09-04') === 0);
ok('a banked freeze holds the display over one missed day', displayedStreak({ ...fresh, count: 5, freezes: 1, lastActiveDate: '2026-09-01' }, '2026-09-03') === 5);
ok('at-risk only when the last session was yesterday', atRisk({ ...fresh, count: 5, lastActiveDate: '2026-09-01' }, '2026-09-02'));
ok('not at risk on the same day', !atRisk({ ...fresh, count: 5, lastActiveDate: '2026-09-02' }, '2026-09-02'));

console.log(fails ? `\n  ${fails} FAILING` : '\n  all streak cases pass');
