#!/usr/bin/env node
/**
 * build-content.mjs — compiles the repo's lessons into the app's content JSON.
 *
 * Source of truth is the repo, always:
 *   milestones/<m>/lessons/week.yaml            week roster (titles, teasers, order)
 *   milestones/<m>/lessons/day-NN-<slug>.md     theory + task, greppable, no answers
 *   milestones/<m>/lessons/day-NN-<slug>.quiz.yaml   the answer key, kept out of the .md
 *
 * Output (build artifacts — never hand-edit):
 *   app/public/content/curriculum.json
 *   app/public/content/weeks/week-NN.json
 *
 * Run: npm run content
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SCHEMA_VERSION = 1;

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..');
const milestonesDir = join(repoRoot, 'milestones');
const outDir = join(appDir, 'public', 'content');

const warnings = [];
const warn = (msg) => warnings.push(msg);

/** Split a markdown doc into its top-level `## ` sections, keyed by lowercased title. */
function splitSections(md) {
  const sections = {};
  const lines = md.split('\n');
  let current = null;
  let buf = [];
  const flush = () => {
    if (current) sections[current] = buf.join('\n').trim();
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1].toLowerCase();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Pull the structured bits out of a `## Task` section, leaving prose behind.
 * Conventions (see day-01 for the canonical shape):
 *   - File: `path`            → task.files[]
 *   - Compile: `command`      → task.compile
 *   ### Checklist            → task.checklist[] from its `- [ ]` items
 */
function parseTask(taskMd) {
  if (!taskMd) return null;

  const files = [];
  let compile = null;
  const checklist = [];

  // The checklist subsection is consumed whole, not left in the prose.
  const checklistSplit = taskMd.split(/^###\s+Checklist\s*$/m);
  const body = checklistSplit[0];
  if (checklistSplit[1]) {
    for (const line of checklistSplit[1].split('\n')) {
      const m = /^\s*-\s*\[[ xX]\]\s+(.*\S)\s*$/.exec(line);
      if (m) checklist.push(m[1]);
    }
  }

  const proseLines = [];
  for (const line of body.split('\n')) {
    const file = /^\s*-\s*(?:📄\s*)?File:\s*`([^`]+)`/i.exec(line);
    if (file) {
      files.push(file[1]);
      continue;
    }
    const cc = /^\s*-\s*Compile:\s*`([^`]+)`/i.exec(line);
    if (cc) {
      compile = cc[1];
      continue;
    }
    proseLines.push(line);
  }

  return {
    markdown: proseLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    files,
    compile,
    checklist,
  };
}

/** How many numbered questions the human-facing `## Quiz` section advertises. */
function countMdQuizQuestions(quizMd) {
  if (!quizMd) return 0;
  return (quizMd.match(/^\s*\d+\.\s+/gm) ?? []).length;
}

/**
 * Deterministic option shuffle.
 *
 * Authoring a quiz, you write the right answer first — it's the one you're sure of,
 * the distractors come after. Do that four days running and the learner has stopped
 * reading the options and started pattern-matching on position, which measures
 * nothing. So the source order is treated as arbitrary and the build lays the options
 * out itself.
 *
 * Seeded rather than random, deliberately: the same lesson must shuffle the same way
 * on every machine and every rebuild, because the app records answers by position and
 * `contentHash` would otherwise churn on every `npm run content`.
 *
 * FNV-1a over the seed string, then xorshift32 — small, no dependency, and stable
 * across Node versions in a way Math.random() explicitly is not.
 */
function rng(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let s = h >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

function shuffle(items, seed) {
  const next = rng(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle every question in a day, then check the day as a whole: a seed that happens
 * to put all five answers in slot C is just as much of a tell as authoring order was.
 * Re-salt until the positions differ; bounded, and the identity fallback is only
 * reachable for a single-question day.
 */
function placeOptions(questions, dayId) {
  for (let salt = 0; salt < 32; salt += 1) {
    const out = questions.map((q) => ({
      ...q,
      options: shuffle(q.options, `${dayId}:${q.id}:${salt}`),
    }));
    const slots = out.map((q) => q.options.findIndex((o) => o.correct));
    if (out.length < 2 || new Set(slots).size > 1) return out;
  }
  return questions;
}

function loadQuiz(path, dayId) {
  if (!existsSync(path)) return null;
  const doc = parseYaml(readFileSync(path, 'utf8'));
  const questions = doc?.questions ?? [];
  if (!Array.isArray(questions) || questions.length === 0) {
    warn(`${dayId}: ${path} has no questions`);
    return null;
  }
  const parsed = questions.map((q, qi) => {
    const options = q.options ?? [];
    const correctCount = options.filter((o) => o.correct).length;
    if (correctCount !== 1) {
      warn(`${dayId} q${qi + 1}: expected exactly 1 correct option, found ${correctCount}`);
    }
    if (options.length < 2 || options.length > 4) {
      warn(`${dayId} q${qi + 1}: ${options.length} options — the app is designed for 2–4`);
    }
    for (const o of options) {
      if (!o.why?.trim()) warn(`${dayId} q${qi + 1}: option "${o.text}" has no "why"`);
    }
    return {
      id: q.id ?? `q${qi + 1}`,
      prompt: String(q.prompt ?? '').trim(),
      options: options.map((o) => ({
        text: String(o.text ?? '').trim(),
        correct: Boolean(o.correct),
        why: String(o.why ?? '').trim(),
      })),
    };
  });

  return placeOptions(parsed, dayId);
}

function buildWeek(milestone) {
  const lessonsDir = join(milestonesDir, milestone, 'lessons');
  const weekYaml = join(lessonsDir, 'week.yaml');
  if (!existsSync(weekYaml)) return null;

  const meta = parseYaml(readFileSync(weekYaml, 'utf8'));
  const lessonFiles = readdirSync(lessonsDir).filter((f) => /^day-\d+-.*\.md$/.test(f));

  const days = (meta.days ?? []).map((d) => {
    const dayNum = String(d.day).padStart(2, '0');
    const mdName = lessonFiles.find((f) => f.startsWith(`day-${dayNum}-`));

    const base = {
      id: d.id,
      day: d.day,
      title: d.title,
      estMinutes: d.estMinutes ?? 25,
      teaser: d.teaser?.trim() ?? null,
      teachBack: d.teachBack?.trim() ?? null,
    };

    if (!mdName) {
      // Listed but not yet written — shows on the map as a locked, titled step.
      return { ...base, status: 'upcoming', theoryMarkdown: null, quiz: null, task: null };
    }

    const slug = mdName.replace(/^day-\d+-/, '').replace(/\.md$/, '');
    const sections = splitSections(readFileSync(join(lessonsDir, mdName), 'utf8'));
    const quiz = loadQuiz(join(lessonsDir, mdName.replace(/\.md$/, '.quiz.yaml')), d.id);

    if (!sections.theory) warn(`${d.id}: ${mdName} has no "## Theory" section`);
    if (!quiz) warn(`${d.id}: no .quiz.yaml — the day will skip straight to the task`);

    const mdCount = countMdQuizQuestions(sections.quiz);
    if (quiz && mdCount && mdCount !== quiz.length) {
      warn(`${d.id}: ${mdName} lists ${mdCount} quiz questions, .quiz.yaml has ${quiz.length}`);
    }

    return {
      ...base,
      slug,
      status: 'available',
      theoryMarkdown: sections.theory ?? null,
      quiz,
      task: parseTask(sections.task),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: meta.id,
    title: meta.title,
    milestone: meta.milestone ?? milestone,
    intro: meta.intro?.trim() ?? '',
    days,
  };
}

function sha256(s) {
  return `sha256:${createHash('sha256').update(s).digest('hex').slice(0, 32)}`;
}

// ---------------------------------------------------------------------------

const milestones = existsSync(milestonesDir)
  ? readdirSync(milestonesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  : [];

mkdirSync(join(outDir, 'weeks'), { recursive: true });

const weekRefs = [];
/** Newest source mtime, so `generatedAt` only moves when the content actually does —
 *  stamping Date.now() here means every build dirties a committed file. */
let newest = 0;
for (const milestone of milestones) {
  const week = buildWeek(milestone);
  if (!week) continue;

  const lessonsDir = join(milestonesDir, milestone, 'lessons');
  for (const f of readdirSync(lessonsDir)) {
    newest = Math.max(newest, statSync(join(lessonsDir, f)).mtimeMs);
  }

  const json = `${JSON.stringify(week, null, 2)}\n`;
  const rel = `content/weeks/${week.id}.json`;
  writeFileSync(join(outDir, 'weeks', `${week.id}.json`), json);

  const available = week.days.filter((d) => d.status === 'available').length;
  weekRefs.push({
    id: week.id,
    title: week.title,
    milestone: week.milestone,
    days: week.days.length,
    availableDays: available,
    url: rel,
    contentHash: sha256(json),
    available: available > 0,
  });

  console.log(`  ${week.id}  ${week.title.padEnd(24)} ${available}/${week.days.length} days written`);
}

const curriculum = {
  schemaVersion: SCHEMA_VERSION,
  title: 'cpp-lab',
  generatedAt: new Date(newest || Date.now()).toISOString(),
  weeks: weekRefs,
};
writeFileSync(join(outDir, 'curriculum.json'), `${JSON.stringify(curriculum, null, 2)}\n`);

console.log(`\n${weekRefs.length} week(s) → app/public/content/`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
