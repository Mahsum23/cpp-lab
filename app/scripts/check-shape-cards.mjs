#!/usr/bin/env node
/**
 * check-shape-cards.mjs — keeps Go and C++ "write it" cards honest.
 *
 * Those cards are judged by *shape* in the app (src/lib/shapecheck.ts), because neither language
 * can be run in a browser. A shape judge is only as good as its patterns, so every card file is
 * checked here against the real toolchain (`go`, `g++`) before it ships:
 *
 *   1. the reference `solution` and every `good` alternative must be accepted by the judge AND
 *      pass the card's `harness` (a real program with `{{GIVEN}}` / `{{ANSWER}}` holes) in the
 *      real compiler, printing `expect` if given;
 *   2. every `bad` example must be rejected by the judge;
 *   3. mutation testing: the solution is damaged one token at a time (deleted, swapped with its
 *      neighbour, replaced by another token from the same answer) and each damaged answer is run
 *      both ways. A mutant the judge accepts but the real compiler/harness rejects is a
 *      FALSE ACCEPT — the card would pass broken code — and fails the check. A mutant the judge
 *      rejects that the harness passes is reported as over-strict (information, not failure:
 *      swapping two independent statements is "right" and not worth a pattern's complexity).
 *
 * Usage:  node scripts/check-shape-cards.mjs [--only <substring>] [--mutants N] [--verbose]
 *         (no files: every milestones/<m>/lessons/*.write.yaml whose lang is go or cpp)
 */
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const cache = join(here, '..', 'node_modules', '.cache', 'slowpath');
mkdirSync(cache, { recursive: true });
const outfile = join(cache, 'shapecheck.mjs');
await build({ entryPoints: [join(here, '..', 'src', 'lib', 'shapecheck.ts')], bundle: true, format: 'esm', platform: 'node', outfile });
const { judge, tokenize } = await import(outfile);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const ONLY = opt('--only', '');
const MUTANTS = Number(opt('--mutants', 60));
const VERBOSE = flag('--verbose');
const POOL = Number(opt('--jobs', 4));

// --- running a harness in the real toolchain ---------------------------------

const work = mkdtempSync(join(tmpdir(), 'shape-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
let nextDir = 0;

function sh(cmd, argv, opts = {}) {
  return new Promise((done) => {
    const p = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), opts.timeout ?? 30_000);
    p.on('close', (code) => { clearTimeout(timer); done({ code, out, err }); });
  });
}

const fill = (harness, given, answer, prelude) =>
  harness.replaceAll('{{PRELUDE}}', prelude ?? '').replaceAll('{{GIVEN}}', given ?? '').replaceAll('{{ANSWER}}', answer);

/** ok = it compiled, ran, exited 0 and printed what the card says it should. */
async function runHarness(lang, harness, given, answer, card, prelude) {
  const expect = card.expect;
  const dir = join(work, String(nextDir++));
  mkdirSync(dir);
  const src = fill(harness, given, answer, prelude);
  if (lang === 'go') {
    writeFileSync(join(dir, 'main.go'), src);
    const r = await sh('go', ['run', 'main.go'], { cwd: dir, env: { ...process.env, GO111MODULE: 'off' } });
    return verdict(r, card);
  }
  writeFileSync(join(dir, 'main.cpp'), src);
  const c = await sh('g++', ['-std=c++20', '-Wall', '-Werror=return-type', '-o', 'a.out', 'main.cpp'], { cwd: dir });
  if (c.code !== 0) return { ok: false, why: 'does not compile', detail: c.err.split('\n').find((l) => /error/.test(l)) ?? c.err.slice(0, 200) };
  return verdict(await sh('timeout', ['5', './a.out'], { cwd: dir }), card);
}

function verdict(r, card) {
  const want = card.exit ?? 0;
  if (r.code !== want) return { ok: false, why: `exit ${r.code} (wanted ${want})`, detail: (r.err || r.out).split('\n').find((l) => l.trim()) ?? '' };
  if (card.expect !== undefined && r.out.trim() !== String(card.expect).trim()) {
    return { ok: false, why: 'wrong output', detail: `got ${JSON.stringify(r.out.trim().slice(0, 120))}` };
  }
  if (card.expectErr !== undefined && !r.err.includes(card.expectErr)) {
    return { ok: false, why: 'wrong stderr', detail: `got ${JSON.stringify(r.err.trim().slice(0, 120))}` };
  }
  return { ok: true };
}

async function pool(jobs, n) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

// --- mutants -----------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function mutants(code, lang, limit, seed) {
  const { toks } = tokenize(code, lang);
  const cut = (a, b, repl) => code.slice(0, a) + repl + code.slice(b);
  const all = new Map();
  const add = (text, how) => { if (text !== code && !all.has(text)) all.set(text, how); };
  const pool_ = [...new Set(toks.map((t) => t.t))];
  toks.forEach((t, i) => {
    add(cut(t.s, t.e, ''), `delete \`${t.t}\``);
    const n = toks[i + 1];
    if (n && n.t !== t.t) add(code.slice(0, t.s) + n.t + code.slice(t.e, n.s) + t.t + code.slice(n.e), `swap \`${t.t}\` \`${n.t}\``);
    if (t.k === 'id' || t.k === 'num' || t.k === 'str') {
      for (const r of pool_) if (r !== t.t && (toks.find((x) => x.t === r)?.k === t.k)) add(cut(t.s, t.e, r), `\`${t.t}\` → \`${r}\``);
    }
  });
  const list = [...all.entries()];
  const r = rng(seed);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, limit);
}

// --- the checks --------------------------------------------------------------

const files = [];
for (const m of readdirSync(join(repo, 'milestones'), { withFileTypes: true })) {
  if (!m.isDirectory()) continue;
  const dir = join(repo, 'milestones', m.name, 'lessons');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (f.endsWith('.write.yaml')) files.push(join(dir, f));
}

let failures = 0, cards = 0, overstrict = 0, mutantsRun = 0;
const say = (s) => console.log(s);

for (const file of files.sort()) {
  const doc = parseYaml(readFileSync(file, 'utf8'));
  const lang = doc.lang;
  if (lang !== 'go' && lang !== 'cpp') continue;
  if (ONLY && !file.includes(ONLY)) continue;
  const defs = doc.defs ?? {};
  say(`\n${file.replace(repo + '/', '')}`);
  for (const c of doc.challenges) {
    cards++;
    const spec = { requires: c.requires ?? [], forbids: c.forbids ?? [] };
    const given = c.given ? String(c.given).trimEnd() : '';
    const problems = [];
    const j = (code) => { try { return judge(code, lang, spec, defs); } catch (e) { if (!problems.includes(`pattern error: ${e.message}`)) problems.push(`pattern error: ${e.message}`); return { ok: false, items: [] }; } };
    const hasHarness = typeof c.harness === 'string';
    const harness = (code) => runHarness(lang, c.harness, given, code, c, doc.prelude);

    // 1. reference + good alternatives: accepted by the judge, and correct for real.
    const goods = [['solution', c.solution], ...(c.good ?? []).map((g, i) => [`good #${i + 1}`, g])];
    const goodRuns = await pool(goods.map(([, code]) => () => (hasHarness ? harness(code) : Promise.resolve({ ok: true }))), POOL);
    goods.forEach(([name, code], i) => {
      const rep = j(code);
      if (!rep.ok) problems.push(`${name} is rejected by the judge: ${rep.items.filter((x) => !x.ok).map((x) => x.say).join(' / ')}`);
      if (!goodRuns[i].ok) problems.push(`${name} fails the real ${lang === 'go' ? 'go' : 'g++'} harness: ${goodRuns[i].why} ${goodRuns[i].detail ?? ''}`);
    });
    if (!hasHarness) problems.push('no harness — nothing proves the reference answer is real code');

    // 2. bad examples: rejected by the judge (and, informatively, by the compiler too).
    const bads = (c.bad ?? []).map((b, i) => [`bad #${i + 1}`, typeof b === 'string' ? b : b.code]);
    const badRuns = await pool(bads.map(([, code]) => () => (hasHarness ? harness(code) : Promise.resolve({ ok: false }))), POOL);
    bads.forEach(([name, code], i) => {
      if (j(code).ok) problems.push(`${name} is accepted by the judge${badRuns[i].ok ? ' (and it really is fine?)' : ` but ${badRuns[i].why}`}: ${code.replace(/\s+/g, ' ').slice(0, 80)}`);
    });

    // 3. mutation testing.
    let accepted = 0, falseAccepts = [], strict = [], ran = 0;
    if (hasHarness && MUTANTS > 0) {
      const ms = mutants(c.solution, lang, MUTANTS, c.id.length * 7919);
      const runs = await pool(ms.map(([text]) => async () => {
        const rep = j(text);
        const real = await harness(text);
        return { text, rep, real };
      }), POOL);
      mutantsRun += ms.length;
      ran = ms.length;
      runs.forEach(({ text, rep, real }, i) => {
        if (rep.ok) accepted++;
        if (rep.ok && !real.ok) falseAccepts.push({ how: ms[i][1], text, real });
        if (!rep.ok && real.ok) strict.push({ how: ms[i][1], text });
      });
      for (const fa of falseAccepts.slice(0, VERBOSE ? 99 : 4)) problems.push(`FALSE ACCEPT (${fa.how}): the judge passes it but ${fa.real.why} ${fa.real.detail ?? ''}\n        ${fa.text.replace(/\s+/g, ' ').slice(0, 140)}`);
      if (falseAccepts.length > 4 && !VERBOSE) problems.push(`… and ${falseAccepts.length - 4} more false accepts`);
      overstrict += strict.length;
    }

    const tag = problems.length ? 'FAIL' : 'ok  ';
    if (problems.length) failures++;
    say(`  ${tag}  ${c.id}  (${goods.length - 1} alt, ${bads.length} bad${hasHarness && MUTANTS > 0 ? `, ${ran} mutants: ${strict.length} over-strict` : ''})`);
    for (const p of problems) say(`        ${p}`);
    if (VERBOSE) for (const s of strict.slice(0, 8)) say(`        over-strict: ${s.how}`);
  }
}

say(`\n${cards} cards, ${mutantsRun} mutants run, ${overstrict} over-strict rejections, ${failures} failing`);
process.exit(failures ? 1 : 0);
