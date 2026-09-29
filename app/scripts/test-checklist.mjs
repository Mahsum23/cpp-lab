/**
 * test-checklist.mjs — a checklist item that runs over two lines in the lesson file was
 * cut off at the first line break in the compiled content: "…off the same index, and you
 * can say what the difference was" became "…off the same". Nothing failed; the app just
 * showed half a requirement. It matters more now that a reviewer grades the work against
 * these items, because half a requirement would be graded as if it were the whole one.
 *
 * This reads the items straight from the lesson files with its own small reader and
 * checks the compiled JSON the app ships holds every one of them, in full.
 *
 * Run: npm test
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

const root = new URL('../../milestones/', import.meta.url).pathname;
const weeksDir = new URL('../public/content/weeks/', import.meta.url).pathname;

/** Items as an author would read them: an indented line continues the item above it. */
function itemsOf(md) {
  const section = md.split(/^###\s+Checklist\s*$/m)[1];
  if (!section) return [];
  const out = [];
  let open = false;
  for (const line of section.split('\n')) {
    const m = /^\s*-\s*\[[ xX]\]\s+(.*\S)\s*$/.exec(line);
    if (m) { out.push(m[1]); open = true; }
    else if (open && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
    else open = false;
  }
  return out;
}

const source = [];
for (const milestone of readdirSync(root)) {
  const lessons = join(root, milestone, 'lessons');
  if (!existsSync(lessons)) continue;
  for (const f of readdirSync(lessons).filter((x) => x.endsWith('.md'))) {
    const md = readFileSync(join(lessons, f), 'utf8');
    const taskSection = md.split(/^## Task\s*$/m)[1] ?? '';
    for (const item of itemsOf(taskSection)) source.push({ item, where: `${milestone}/${f}` });
  }
}

const compiled = [];
for (const f of readdirSync(weeksDir).filter((x) => x.endsWith('.json'))) {
  const week = JSON.parse(readFileSync(join(weeksDir, f), 'utf8'));
  for (const d of week.days) for (const c of d.task?.checklist ?? []) compiled.push(c);
}

console.log('\n— every checklist item reaches the app whole —');
ok('there are checklist items to check', source.length > 10, String(source.length));
const missing = source.filter(({ item }) => !compiled.includes(item));
ok('every item in the lesson files is in the compiled content, word for word', missing.length === 0,
  missing.slice(0, 3).map((m) => `${m.where}: …${m.item.slice(-70)}`).join('\n        '));
ok('and nothing extra is in the compiled content', compiled.length === source.length, `${compiled.length} compiled vs ${source.length} in source`);

// The one that was reported, by name, so a regression reads as what it is.
ok('the Index Only Scan item keeps its ending', compiled.some((c) => c.endsWith('and you can say what the difference was')));
ok('the refused-index item keeps its ending', compiled.some((c) => c.endsWith('timings showing it was right to')));

console.log(fails ? `\n  ${fails} FAILING` : '\n  all checklist cases pass');
process.exit(fails ? 1 : 0);
