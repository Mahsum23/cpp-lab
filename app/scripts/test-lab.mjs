/**
 * test-lab.mjs — `./lab` decides which day you are on, and that decision was wrong twice
 * during its first hour of life. Both bugs are pinned here.
 *
 * Run: npm test
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

/** A throwaway copy of the repo's content, so tests never touch real work files. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'lab-'));
  mkdirSync(join(dir, 'tools'), { recursive: true });
  cpSync(join(repo, 'tools', 'lab.mjs'), join(dir, 'tools', 'lab.mjs'));
  cpSync(join(repo, 'app', 'public', 'content'), join(dir, 'app', 'public', 'content'), { recursive: true });
  return dir;
}

function lab(dir, args = []) {
  const r = spawnSync('node', [join(dir, 'tools', 'lab.mjs'), ...args], {
    encoding: 'utf8',
    // No token: the gist path is not what these tests are about, and a stray
    // GITHUB_TOKEN in the environment would make them depend on someone's account.
    env: { ...process.env, LAB_TOKEN: '', GITHUB_TOKEN: '' },
  });
  return `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
}

const dir = sandbox();

console.log('\n— it finds a day at all —');
let out = lab(dir, ['--track', 'go']);
ok('opens the first Go day', out.includes('Day 1 — Hello'), out.slice(0, 200));
ok('and scaffolds its file', existsSync(join(dir, 'go', 'day01', 'hello.go')));
ok('the stub carries the checklist', readFileSync(join(dir, 'go/day01/hello.go'), 'utf8').includes('[ ] `go version` printed'));
ok('and is a compilable skeleton, not an empty file',
  readFileSync(join(dir, 'go/day01/hello.go'), 'utf8').includes('func main()'));

console.log('\n— the bug where scaffolding a file finished the day —');
/**
 * Writing day 1's file used to make the "first day whose file does not exist" fallback
 * skip day 1, so `./lab` opened day 1 and `./lab check` immediately ran day 2.
 */
out = lab(dir, ['--track', 'go']);
ok('a second run stays on the same day', out.includes('Day 1 — Hello'), out.slice(0, 200));
ok('and does not recreate the file', out.includes('exists'), out.slice(0, 300));

console.log('\n— done advances, and only then —');
lab(dir, ['done', '--track', 'go']);
out = lab(dir, ['--track', 'go']);
ok('after ./lab done it moves on', out.includes('Day 2 — Zero values'), out.slice(0, 200));

console.log('\n— the shared-path track —');
/**
 * Every day of the sockets week writes to src/main.cpp. File existence therefore says
 * nothing about which day you are on, which is why the sticky pointer exists.
 */
out = lab(dir, ['--track', 'cpp']);
ok('opens sockets day 1', out.includes('Day 1 — A socket'), out.slice(0, 200));
lab(dir, ['done', '--track', 'cpp']);
out = lab(dir, ['--track', 'cpp']);
ok('and reaches day 2 even though src/main.cpp already exists',
  out.includes('Day 2 — Addresses'), out.slice(0, 200));

console.log('\n— days that declare no file —');
out = lab(dir, ['--day', 'day-07']);
ok('day 7 is reachable despite having no files', out.includes('Day 7'), out.slice(0, 200));
ok('and says so rather than pretending to scaffold', out.includes('names no file'), out.slice(0, 400));
ok('while still printing its run command', out.includes('g++'), out.slice(0, 400));

console.log('\n— listing and lookup —');
out = lab(dir, ['list']);
for (const t of ['Raw Sockets', 'Go, From Zero', 'What the Database Does']) {
  ok(`list shows ${t}`, out.includes(t));
}
ok('list includes the file-less days', out.includes('Watch it work'), out.slice(0, 900));
out = lab(dir, ['--day', 'nope-day-99']);
ok('an unknown day is an error, not a silent first day', out.includes('No day "nope-day-99"'), out.slice(0, 200));

console.log('\n— checklist rendering —');
out = lab(dir, ['--day', 'sql-day-01']);
ok('markdown backticks are stripped for the terminal', !out.includes('`pg_relation_size`'), out.slice(0, 600));

rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n  ${fails} FAILING` : '\n  all lab cases pass');
process.exit(fails ? 1 : 0);
