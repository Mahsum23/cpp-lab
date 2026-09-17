/**
 * test-drill.mjs — the drill is the half of a day you can do on a phone, and letting the
 * day ring close on it is the whole point. That makes two things load-bearing:
 *
 *  - a record written before drills existed must survive being read (it has no `drill`
 *    field at all, and every access would otherwise throw);
 *  - the two halves must merge independently across devices.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function load(entry, name) {
  const out = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, format: 'esm', write: false,
  });
  const file = join(tmpdir(), name);
  writeFileSync(file, out.outputFiles[0].text);
  return import(file);
}

const { mergeProgress } = await load('../src/lib/merge.ts', 'cpp-lab-drill-merge.mjs');
const { emptyDayProgress, defaultProgress } = await load('../src/lib/types.ts', 'cpp-lab-drill-types.mjs');

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

const withDay = (day) => ({ ...defaultProgress(), days: { 'go-day-01': day } });

console.log('\n— the zero value of a day —');
const blank = emptyDayProgress('week-go-01');
ok('a fresh day has drill state', blank.drill !== undefined, JSON.stringify(blank));
ok('and it starts empty', Object.keys(blank.drill.answers).length === 0);
ok('quiz and drill are separate objects', blank.quiz !== blank.drill);

console.log('\n— a record written before drills existed —');
/**
 * The failure this guards: another device still running the old build syncs a day with
 * no `drill` key, and every read of `p.drill.completedAt` throws on the way in.
 */
const legacy = { ...emptyDayProgress('week-go-01') };
delete legacy.drill;
const fresh = { ...emptyDayProgress('week-go-01') };
fresh.drill.answers = { d1: 2 };
fresh.drill.correct = { d1: true };
fresh.drill.completedAt = '2026-09-17T10:00:00.000Z';

let merged = mergeProgress(withDay(legacy), withDay(fresh)).days['go-day-01'];
ok('merging a legacy record does not throw', Boolean(merged));
ok('and the side that has drill answers keeps them', merged.drill.answers.d1 === 2, JSON.stringify(merged.drill));
merged = mergeProgress(withDay(fresh), withDay(legacy)).days['go-day-01'];
ok('in either direction', merged.drill.answers.d1 === 2, JSON.stringify(merged.drill));

console.log('\n— two devices, two halves —');
const phone = { ...emptyDayProgress('week-go-01') };
phone.drill.answers = { d1: 0, d2: 1 };
phone.drill.correct = { d1: true, d2: false };
phone.drill.completedAt = '2026-09-17T09:00:00.000Z';

const laptop = { ...emptyDayProgress('week-go-01') };
laptop.task = 'done';
laptop.checklist = [true, true];

merged = mergeProgress(withDay(phone), withDay(laptop)).days['go-day-01'];
ok('the phone half survives', merged.drill.completedAt === '2026-09-17T09:00:00.000Z');
ok('the machine half survives', merged.task === 'done');
ok('and the checklist comes with it', merged.checklist[0] === true && merged.checklist[1] === true);

console.log('\n— an answer and its verdict travel together —');
const a = { ...emptyDayProgress('w') };
a.drill.answers = { d1: 3 };
a.drill.correct = { d1: false };
const bside = { ...emptyDayProgress('w') };
bside.drill.answers = { d1: 1 };
bside.drill.correct = { d1: true };
merged = mergeProgress(withDay(a), withDay(bside)).days['go-day-01'];
ok('local answer wins with its own verdict, not the other record\'s',
  merged.drill.answers.d1 === 3 && merged.drill.correct.d1 === false, JSON.stringify(merged.drill));

console.log('\n— the quiz is untouched by any of this —');
const q = { ...emptyDayProgress('w') };
q.quiz.answers = { q1: 2 };
q.quiz.correct = { q1: true };
q.quiz.cleanSweep = true;
merged = mergeProgress(withDay(q), withDay({ ...emptyDayProgress('w') })).days['go-day-01'];
ok('quiz answers still merge', merged.quiz.answers.q1 === 2);
ok('and a clean sweep is still sticky', merged.quiz.cleanSweep === true);

console.log(fails ? `\n  ${fails} FAILING` : '\n  all drill cases pass');
process.exit(fails ? 1 : 0);
