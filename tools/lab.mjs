#!/usr/bin/env node
/**
 * lab — get from a cold terminal to editing the right file, in one command.
 *
 * The tasks in this curriculum need a machine, and the cost of doing one was never the
 * coding. It was the preparation: work out which day you are on, remember what it asked,
 * make a directory, make a file, remember the run command. Six small frictions, each one
 * a chance to decide not to bother. This collapses them into `./lab`.
 *
 *   ./lab              scaffold the current day's files and print what it wants
 *   ./lab check        run the day's build/run command
 *   ./lab list         where you are, and what is left
 *   ./lab --day go-day-03     any specific day, in any track
 *
 * Deliberately dependency-free and offline-first: it reads the same content JSON the
 * phone app is built from, so there is nothing to install and nothing to keep in sync.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = join(repo, 'app', 'public', 'content');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function loadWeeks() {
  const dir = join(contentDir, 'weeks');
  if (!existsSync(dir)) {
    console.error(`No content found at ${dir}.\nRun: cd app && npm run content`);
    process.exit(1);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Every day that has a task, flattened, in curriculum order. */
function allDays(weeks) {
  const out = [];
  for (const w of weeks) {
    for (const d of w.days) {
      // A day with a checklist but no declared files is still a day you can work on —
      // days 7 and 8 of the sockets week build a server and a client whose paths the
      // lesson leaves to you, and dropping them from the list made the command lie.
      if (d.task) out.push({ week: w, day: d });
    }
  }
  return out;
}

/**
 * Which day are you on?
 *
 * Four sources, best first, because no single one is reliable on its own.
 *
 * The obvious idea — "the first day whose task file does not exist yet" — is wrong on
 * this repo's own content: every day of the sockets week writes to `src/main.cpp`, each
 * one replacing the last, so once day 1 exists days 2 through 6 all look finished. It
 * survives only as a last resort for tracks that do use a path per day.
 *
 * The honest source is the progress the app syncs to a gist, since the phone is usually
 * further ahead than the repo. That needs a token, so it cannot be the only answer
 * either. When a lower source is used, say so rather than being quietly wrong.
 */
async function resolveDay(days, track, quiet) {
  const pool = track ? days.filter(({ week }) => (week.track ?? 'cpp') === track) : days;
  const state = localState();

  const synced = await syncedProgress(quiet);
  const done = new Set([...(synced ?? []), ...state.done]);
  let via = synced ? 'your synced progress' : null;

  // Sticky: once a day has been opened it stays current until it is finished, so
  // `./lab` and `./lab check` can never disagree about which day they mean. Without
  // this, scaffolding day 1's file made the fallback below consider day 1 finished and
  // the very next command ran day 2.
  if (state.current && !done.has(state.current)) {
    const held = pool.find(({ day }) => day.id === state.current);
    if (held) return { entry: held, via: via ?? 'in progress — ./lab done when it is finished' };
  }

  if (synced) {
    const next = pool.find(({ day }) => !done.has(day.id));
    return { entry: next ?? null, via };
  }

  if (state.done.size) {
    const next = pool.find(({ day }) => !done.has(day.id));
    return { entry: next ?? null, via: '.lab/state.json — ./lab done when a day is finished' };
  }

  const next = pool.find(({ day }) => day.task.files.length && !day.task.files.every((f) => existsSync(join(repo, f))));
  return { entry: next ?? pool[0] ?? null, via: 'which files exist — set LAB_TOKEN for real progress' };
}

/** Days marked complete in the gist the app syncs to, or null if we cannot look. */
async function syncedProgress(quiet) {
  const token = process.env.LAB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch('https://api.github.com/gists', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`gists: ${res.status}`);
    const gists = await res.json();
    const hit = gists.find((g) => g.files && 'cpp-lab-progress.json' in g.files);
    if (!hit) return null;
    const file = hit.files['cpp-lab-progress.json'];
    const text = file.truncated || file.content === undefined
      ? await (await fetch(file.raw_url)).text()
      : file.content;
    const payload = JSON.parse(text);
    const record = payload.progress?.days ?? payload.days ?? {};
    return new Set(Object.entries(record).filter(([, v]) => v?.completedAt).map(([k]) => k));
  } catch (err) {
    if (!quiet) console.error(c.yellow(`  (could not read synced progress: ${err.message})`));
    return null;
  }
}

const STATE = join(repo, '.lab', 'state.json');

function localState() {
  try {
    const raw = JSON.parse(readFileSync(STATE, 'utf8'));
    return { done: new Set(raw.done ?? []), current: raw.current ?? null };
  } catch {
    return { done: new Set(), current: null };
  }
}

function writeState(next) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify({ done: [...next.done], current: next.current }, null, 2)}\n`);
}

function markCurrent(dayId) {
  const s = localState();
  if (s.current === dayId) return;
  writeState({ ...s, current: dayId });
}

function markDone(dayId) {
  const s = localState();
  s.done.add(dayId);
  writeState({ done: s.done, current: null });
}

const COMMENT = { cpp: '//', go: '//', sql: '--' };

function stub(track, file, day, week) {
  const hash = COMMENT[track] ?? '//';
  const head = [
    `${hash} ${week.title} — Day ${day.day}: ${day.title}`,
    `${hash}`,
    ...day.task.checklist.map((item) => `${hash} [ ] ${item}`),
    `${hash}`,
    `${hash} Run: ${day.task.compile ?? '(see the lesson)'}`,
    '',
  ];
  if (track === 'go' && file.endsWith('.go')) {
    head.push('package main', '', 'import "fmt"', '', 'func main() {', '\tfmt.Println("day ' + day.day + '")', '}', '');
  } else if (track === 'cpp' && /\.(cpp|cc)$/.test(file)) {
    head.push('#include <cstdio>', '', 'int main() {', '    std::printf("day ' + day.day + '\\n");', '    return 0;', '}', '');
  }
  return head.join('\n');
}

function scaffold(entry) {
  const { week, day } = entry;
  const track = week.track ?? 'cpp';
  const made = [];
  const existed = [];
  for (const rel of day.task.files) {
    const abs = join(repo, rel);
    if (existsSync(abs)) { existed.push(rel); continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, stub(track, rel, day, week));
    made.push(rel);
  }
  return { made, existed };
}

function show(entry, { made, existed }, via) {
  const { week, day } = entry;
  console.log('');
  console.log(`  ${c.dim(week.title)} ${c.dim('·')} ${c.bold(`Day ${day.day} — ${day.title}`)}`);
  if (via) console.log(`  ${c.dim(`from ${via}`)}`);
  console.log('');
  for (const f of made) console.log(`  ${c.green('created')}  ${f}`);
  for (const f of existed) console.log(`  ${c.dim('exists')}   ${f}`);
  if (day.task.checklist.length) {
    console.log('');
    // Backticks are markdown for the phone; in a terminal they are just noise.
    for (const item of day.task.checklist) console.log(`  ${c.dim('[ ]')} ${item.replace(/`/g, '')}`);
  }
  if (!made.length && !existed.length) {
    console.log(`  ${c.dim('this day names no file — see the lesson for what to build')}`);
  }
  if (day.task.compile) {
    console.log('');
    console.log(`  ${c.cyan('run')}      ${day.task.compile}`);
    console.log(`  ${c.dim('or')}       ./lab check`);
  }
  console.log('');
}

function check(entry) {
  const cmd = entry.day.task.compile;
  if (!cmd) { console.error('This day has no run command.'); process.exit(1); }
  console.log(`\n  ${c.cyan('$')} ${cmd}\n`);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: repo });
  process.exit(r.status ?? 1);
}

function list(days) {
  let lastWeek = null;
  for (const { week, day } of days) {
    if (week.id !== lastWeek) {
      console.log(`\n  ${c.bold(week.title)} ${c.dim(`(${week.track ?? 'cpp'})`)}`);
      lastWeek = week.id;
    }
    const done = day.task.files.every((f) => existsSync(join(repo, f)));
    const mark = done ? c.green('✓') : c.dim('·');
    console.log(`    ${mark} ${c.dim(String(day.day).padStart(2))}  ${day.title}`);
  }
  console.log('');
}

// --- main -----------------------------------------------------------------

const argv = process.argv.slice(2);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const wantDay = valueOf('--day');
const wantTrack = valueOf('--track');
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--day' && argv[i - 1] !== '--track');
const cmd = positional[0] ?? null;

const weeks = loadWeeks();
const days = allDays(weeks);

if (cmd === 'list') {
  list(days);
  process.exit(0);
}

let entry = null;
let via = null;
if (wantDay) {
  entry = days.find(({ day }) => day.id === wantDay) ?? null;
  if (!entry) {
    console.error(`No day "${wantDay}". Try ./lab list`);
    process.exit(1);
  }
} else {
  ({ entry, via } = await resolveDay(days, wantTrack, cmd === 'check'));
}

if (cmd === 'done') {
  if (!entry) { console.error('Nothing to mark done.'); process.exit(1); }
  markDone(entry.day.id);
  console.log(`\n  ${c.green('✓')} ${entry.day.title} ${c.dim('marked done locally')}\n`);
  process.exit(0);
}

if (!entry) {
  console.log(`\n  ${c.green('Nothing left in this track.')} ${c.dim('./lab list')} to see it all,`);
  console.log(`  ${c.dim('./lab --day <id>')} to reopen one.\n`);
  process.exit(0);
}

if (cmd === 'check') check(entry);

markCurrent(entry.day.id);
show(entry, scaffold(entry), via);
