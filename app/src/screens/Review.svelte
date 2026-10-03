<script lang="ts">
  /**
   * The review deck: old material, dealt back at you.
   *
   * Five kinds of card, deliberately mixed so a session never settles into a rhythm.
   * A write card makes you type something from memory. A SQL one is run in a PostgreSQL
   * on this device and judged by the rows it returns; a Go or C++ one cannot be run in a
   * browser, so it is judged by shape (shapecheck.ts) — and its card file was checked
   * against the real compiler before it shipped.
   * A quiz card is one you already answered weeks ago, replayed from the stored bank —
   * it needs no network and no key, which is what keeps the deck usable on a train. A
   * teach-back card asks you to explain a mechanism and is graded. A forged card is
   * written fresh by the model from that day's material, so it is one you have provably
   * never seen; those are the ones that catch you.
   *
   * Nothing here is a gate. You can walk away mid-card and the ones you cleared stay
   * cleared, because a review system you can't quit is one you start avoiding.
   */
  import { tick, untrack } from 'svelte';
  import { answerKeys, focusComposer, mentorKey } from '../lib/shortcuts.svelte';
  import { app } from '../lib/app.svelte';
  import { router } from '../lib/router.svelte';
  import Button from '../components/Button.svelte';
  import Markdown from '../components/Markdown.svelte';
  import { highlight } from '../lib/markdown';
  import CodeArea from '../components/CodeArea.svelte';
  import { asCodeBlock, hasFence, shapeOf } from '../lib/compose';
  import MentorSheet from '../components/MentorSheet.svelte';
  import { codeBlocksFor, isDue, pickNext, type CardRef } from '../lib/review';
  import { buildRound, LAND_AT, MIN_ROUND, practiceStatus } from '../lib/practice';
  import { sql } from '../lib/sqlrun.svelte';
  import { judge, type ShapeReport } from '../lib/shapecheck';
  import { compareResults, forbiddenHit, isOrdered, type ResultTable, type Verdict } from '../lib/writecheck';
  import type { TableInfo } from '../lib/sqlcore';
  import ResultGrid from '../components/ResultGrid.svelte';
  import { today } from '../lib/date';
  import {
    collect, forgeData, forgePrompt, looksComplete, parseVerdict, reviewGraderPrompt, streamReply, stripMarkers,
    MAX_REVIEW_MESSAGES, ModelGoneError, withStanding, type ChatMessage, type MentorFocus,
  } from '../lib/mentor';
  import { TRACKS, type Day, type DrillStep, type QuizQuestion, type Track, type Week, type WriteChallenge, type WriteSet } from '../lib/types';
  import { inlineHtml } from '../lib/inline';

  /** Cards dealt this sitting, so the same one can't come round twice in a row. */
  let seen = $state<Set<string>>(new Set());
  let card = $state<CardRef | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Quiz card.
  let picked = $state<number | null>(null);
  let asking = $state(false);

  /**
   * Practice you asked for, rather than practice you owed.
   *
   * Deals from the whole deck regardless of what's due. A correct answer here can't
   * push a card further out — see the `early` rule in review.ts — so cramming can
   * sharpen the schedule but never flatter it.
   */
  let { practice: startInPractice = false, round: roundDay = null }: { practice?: boolean; round?: string | null } = $props();

  /**
   * A practice round (practice.ts): a fixed list of items from one day's bank, dealt in
   * order. Every item's first attempt is recorded, and the round's score can land the
   * concept and open the next lesson.
   */
  let roundCards = $state<CardRef[] | null>(null);
  let roundAt = $state(0);
  let roundRight = $state(0);
  let roundDone = $state<{ asked: number; right: number; landed: boolean } | null>(null);
  const roundCtx = $derived.by(() => {
    if (!roundDay) return null;
    for (const week of app.weeks) {
      const day = week.days.find((d) => d.id === roundDay);
      if (day) return { week, day };
    }
    return null;
  });
  // Seed only. After that it's a local toggle: arriving via /review/practice starts you
  // in practice, but finishing the due cards and tapping "Keep practising" must be able
  // to flip it on without the URL disagreeing.
  let practice = $state(untrack(() => startInPractice));

  // Parsons card: reorder the shuffled lines of a real block from the lesson.
  let bank = $state<string[]>([]);
  let built = $state<string[]>([]);
  let solution = $state<string[]>([]);
  let checked = $state(false);

  // Write card: a query typed from memory, run for real.
  type Attempt =
    | { kind: 'right'; sql: string; table: ResultTable }
    | { kind: 'wrong'; sql: string; table: ResultTable; verdict: Exclude<Verdict, { ok: true }> }
    | { kind: 'error'; sql: string; message: string; ruled?: boolean };
  let writeSql = $state('');
  let target = $state<ResultTable | null>(null);
  let tables = $state<TableInfo[] | null>(null);
  let attempts = $state<Attempt[]>([]);
  let running = $state(false);
  let hinted = $state(false);
  let revealed = $state(false);
  /** The first run (or a hint, or giving up) is what the schedule hears; later tries are free. */
  let writeGraded = $state(false);
  /** Go/C++ write card: each answer you checked, with what the judge made of it. */
  type ShapeTry = { code: string; report: ShapeReport };
  let shapeTries = $state<ShapeTry[]>([]);

  // Graded cards.
  let challenge = $state('');
  let answer = $state('');
  let codeMode = $state(false);
  /** The exchange about this card: what they said, and what came back (markers and all). */
  let turns = $state<ChatMessage[]>([]);
  let area = $state<ReturnType<typeof CodeArea> | null>(null);
  let streaming = $state(false);
  let verdict = $state<'solid' | 'gaps' | null>(null);

  const context = $derived.by((): { week: Week; day: Day } | null => {
    if (!card) return null;
    for (const week of app.weeks) {
      const day = week.days.find((d) => d.id === card!.dayId);
      if (day) return { week, day };
    }
    return null;
  });

  /** The language of the week this card came from, not of the track you're on now. */
  const lang = $derived(TRACKS[(context?.week.track ?? 'cpp') as Track].lang);

  const question = $derived.by((): QuizQuestion | DrillStep | null => {
    if (!context) return null;
    if (card?.kind === 'quiz') return context.day.quiz?.find((q) => q.id === card!.questionId) ?? null;
    if (card?.kind === 'drill') return findDrill(context.day, card.questionId);
    return null;
  });
  /** A drill step carries a listing to reason about; a quiz question does not. */
  const listing = $derived(question && 'code' in question ? question.code : null);
  /** What a drill's listing is written in: the day's write language, else the track's. */
  const wLangOfDay = $derived(context?.day.practice?.write?.lang ?? context?.day.write?.lang ?? lang);

  const writeHit = $derived.by(() => (card?.kind === 'write' && context ? findWrite(context.day, card.questionId) : null));
  const wc = $derived(writeHit?.c ?? null);
  const writeSetup = $derived(writeHit?.set.setup ?? '');
  /** What the card is written in. SQL is run; Go and C++ are judged by shape. */
  const wLang = $derived(writeHit?.set.lang ?? 'sql');
  const shaped = $derived(wc !== null && wLang !== 'sql');
  /** Whether row order is part of this answer. */
  const wOrdered = $derived(wc ? (wc.ordered ?? isOrdered(wc.verify ?? wc.solution)) : false);
  const solved = $derived(shaped ? shapeTries.some((t) => t.report.ok) : attempts.some((a) => a.kind === 'right'));

  /** Graded cards need the mentor; without a key the deck falls back to quiz cards. */
  const graded = $derived(card?.kind === 'explain' || card?.kind === 'forge');
  // Write cards need neither a key nor a network, only the SQL engine — which, if it
  // could not be fetched and was never cached, is simply absent from the deck.
  const answerable = $derived(
    app.deck.filter((c) =>
      c.kind === 'write'
        ? writeLangOf(c) !== 'sql' || sql.state !== 'failed'
        : c.kind === 'quiz' || c.kind === 'parsons' || app.mentorReady,
    ),
  );

  /**
   * The card, as the mentor needs to see it. Without this it only knows the day, and a
   * question about a quiz card gets answered with "how's the day's task going?".
   *
   * Only built once the card is answered — the Ask button only appears then, and before
   * that the mentor would just be the answer key.
   */
  const focus = $derived.by((): MentorFocus | null => {
    if (!card || !context || !answered) return null;
    if ((card.kind === 'quiz' || card.kind === 'drill') && question) {
      const mine = picked !== null ? question.options[picked] : null;
      const right = question.options.find((o) => o.correct);
      return {
        label: 'From the quiz',
        question: question.prompt,
        outcome: [
          mine ? `You picked: ${mine.text} ${mine.correct ? '✓' : '✗'}` : '',
          mine && !mine.correct && right ? `Right answer: ${right.text}` : '',
        ].filter(Boolean),
        brief: [
          `A multiple-choice ${card.kind === 'drill' ? 'drill' : 'quiz'} card: "${question.prompt}"`,
          ...(listing ? ['The code it is about:', '```', listing, '```'] : []),
          'The options, with the answer key and why each is right or wrong:',
          ...question.options.map(
            (o, i) => `- ${o.correct ? '[correct]' : '[wrong]'}${i === picked ? ' [THEIR PICK]' : ''} ${o.text} — ${o.why}`,
          ),
        ].join('\n'),
      };
    }
    if ((card.kind === 'forge' || card.kind === 'explain') && prompt) {
      return {
        label: card.kind === 'forge' ? 'Fresh challenge' : 'Explain it',
        question: prompt,
        outcome: [verdict === 'solid' ? 'Marked solid ✓' : verdict === 'gaps' ? 'Marked: gaps ✗' : ''].filter(Boolean),
        brief:
          `A ${card.kind === 'forge' ? 'recall challenge' : 'teach-back question'}:\n\n${prompt}\n\n` +
          `The conversation about it so far:\n\n` +
          (turns
            .map((t) => `${t.role === 'user' ? 'They' : 'The marker'}: ${stripMarkers(t.content)}`)
            .join('\n\n') || '(nothing yet)'),
      };
    }
    if (card.kind === 'write' && wc && shaped) {
      const fence = (q: string) => `\`\`\`${wLang}\n${q}\n\`\`\``;
      const tried = shapeTries
        .map((t, i) => {
          const missed = t.report.items.filter((x) => !x.ok).map((x) => x.say);
          return `Attempt ${i + 1} — ${t.report.ok ? 'it had everything the card looks for' : `it missed: ${missed.join('; ')}`}:\n\n${fence(t.code)}`;
        })
        .join('\n\n');
      return {
        label: 'Write it',
        question: wc.prompt,
        outcome: [solved ? 'Your answer had everything the card looks for ✓' : revealed ? 'You asked for the answer ✗' : ''].filter(Boolean),
        brief:
          `A write-it-from-memory card in ${wLang === 'go' ? 'Go' : 'C++'}. It is judged by the *shape* of the answer, not by running it, so an answer the judge rejected may still be valid code, and one it accepted is only known to contain the right pieces.\n\n` +
          (given(wc) ? `Code they were given:\n\n${fence(given(wc)!)}\n\n` : '') +
          `The task: ${wc.prompt}\n\nThe reference answer:\n\n${fence(wc.solution)}\n\n` +
          (wc.note ? `Why it is this way: ${wc.note}\n\n` : '') +
          (tried ? `What they wrote:\n\n${tried}` : 'They did not check anything.') +
          (hinted ? '\n\nThey asked for the hint.' : ''),
      };
    }
    if (card.kind === 'write' && wc) {
      const fence = (q: string) => `\`\`\`sql\n${q}\n\`\`\``;
      const tried = attempts
        .map((a, i) => {
          const what =
            a.kind === 'right' ? 'it returned the target' : a.kind === 'error' ? `Postgres said: ${a.message}` : `wrong rows (${a.verdict.reason})`;
          return `Attempt ${i + 1} — ${what}:\n\n${fence(a.sql)}`;
        })
        .join('\n\n');
      return {
        label: 'Write the query',
        question: wc.prompt,
        outcome: [solved ? 'Your query returned the target ✓' : revealed ? 'You asked for the answer ✗' : ''].filter(Boolean),
        brief:
          `A write-the-query card: they had to type this query from memory and have it run against a real database.\n\n` +
          `The task: ${wc.prompt}\n\nThe reference answer:\n\n${fence(wc.solution)}\n\n` +
          (tried ? `What they ran:\n\n${tried}` : 'They did not run anything.') +
          (hinted ? '\n\nThey asked for the hint.' : ''),
      };
    }
    if (card.kind === 'parsons' && solution.length) {
      const block = (lines: string[]) => `\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``;
      return {
        label: 'Rebuild it',
        question: block(solution),
        outcome: [parsonsRight ? 'You got the order right ✓' : 'The order was off ✗'],
        brief: `A reorder card: they had to put these lines back in order. The correct order:\n\n${block(solution)}\n\nThe order they chose:\n\n${block(built)}`,
      };
    }
    return null;
  });

  const remaining = $derived(app.dueNow.filter((c) => !seen.has(c.id)).length);
  /** Their next message will be the last one allowed on this card. */
  const lastChance = $derived(
    graded && !verdict && turns.filter((t) => t.role === 'user').length === MAX_REVIEW_MESSAGES - 1,
  );

  const answered = $derived(picked !== null || verdict !== null || checked || solved || revealed);

  /**
   * Openers for the sheet, shaped by the card you just answered.
   *
   * The wrong-answer case names the option you actually picked, because "why is B
   * right" is a much less useful question than "where does my reasoning break".
   */
  const suggestions = $derived.by(() => {
    if (!context) return [];
    const missed = picked !== null ? !question?.options[picked]?.correct : verdict === 'gaps';
    if (card?.kind === 'quiz' && picked !== null && missed) {
      return [
        { text: `I answered "${question?.options[picked]?.text ?? ''}" — where does that reasoning break?` },
        { text: 'Explain the right answer from first principles' },
        { text: 'Show me this one in code' },
      ];
    }
    if (missed) return [{ text: 'Explain what I missed, properly' }, { text: 'Show me this one in code' }];
    return [
      { text: 'Why is that the answer?' },
      { text: 'When would this actually bite in real code?' },
      { text: `What else from day ${context.day.day} should I be able to recall?` },
    ];
  });

  function reset() {
    picked = null;
    asking = false;
    bank = [];
    built = [];
    solution = [];
    checked = false;
    challenge = '';
    answer = '';
    codeMode = false;
    turns = [];
    verdict = null;
    error = null;
    writeSql = '';
    target = null;
    tables = null;
    attempts = [];
    running = false;
    hinted = false;
    revealed = false;
    writeGraded = false;
    shapeTries = [];
  }

  async function deal() {
    const previous = card?.kind;
    reset();
    if (roundCards) {
      const next = roundCards[roundAt] ?? null;
      card = next;
      if (!next) return void endRound();
      if (next.kind === 'write') await setupWrite(next);
      return;
    }
    // In practice mode nothing is "due", so every card is fair game; `seen` still
    // stops the same one coming round twice in a sitting.
    const on = practice ? '9999-12-31' : today();
    const next = pickNext(answerable, app.progress.review, on, Math.random, seen, previous);
    card = next;
    if (next?.kind === 'forge') await forge();
    if (next?.kind === 'parsons') setupParsons(next);
    if (next?.kind === 'write') await setupWrite(next);
  }

  /**
   * Get a write card ready: the engine up, the tables drawn, and the reference answer run
   * to make the target. All three come from the engine rather than from the card file, so
   * what you are shown is always what the reference actually returns.
   *
   * A card that cannot be set up is dropped, not graded. If the engine will not start (no
   * network the first time) that is not a wrong answer, and if the card's own setup is
   * broken that is the lesson's bug — it is reported to the console for whoever wrote it.
   */
  async function setupWrite(ref: CardRef) {
    const day = findDay(ref.dayId);
    const hit = day ? findWrite(day, ref.questionId) : null;
    if (!hit) return setAside(ref);
    const { set, c } = hit;
    codeMode = true;
    // Go and C++ need no engine and nothing to load: the card is ready the moment it is dealt.
    if (set.lang !== 'sql') {
      await tick();
      area?.focus();
      return;
    }
    loading = true;
    try {
      if (!(await sql.warm())) return setAside(ref);
      const [t, ref_] = await Promise.all([
        sql.describe(set.setup),
        sql.run({ setup: set.setup, sql: c.solution, verify: c.verify ?? undefined }),
      ]);
      if (card?.id !== ref.id) return; // dealt past while it was loading
      if (!ref_.ok) {
        console.error(`[write] ${ref.id}: the reference answer failed (${ref_.stage}): ${ref_.error}`);
        return setAside(ref);
      }
      tables = t;
      target = ref_.table;
    } finally {
      loading = false;
    }
    await tick();
    area?.focus();
  }

  /** Put a card aside without grading it, and deal another. */
  async function setAside(ref: CardRef) {
    loading = false;
    if (roundCards) {
      // Not counted either way: a card the device could not set up is not a wrong answer.
      roundCards = roundCards.filter((c) => c.id !== ref.id);
      return deal();
    }
    seen = new Set([...seen, ref.id]);
    await deal();
  }

  async function runWrite() {
    if (shaped) return checkShape();
    const text = writeSql.trim();
    if (!text || running || solved || revealed || !wc || !target) return;
    // A card about how the query is written can rule things out before anything runs.
    const ruledOut = forbiddenHit(text, wc.forbids);
    if (ruledOut) {
      const attempt: Attempt = { kind: 'error', sql: text, message: `This card rules that out: ${ruledOut}.`, ruled: true };
      attempts = [...attempts, attempt];
      if (!writeGraded) {
        writeGraded = true;
        await settle('again');
      }
      await tick();
      area?.focus();
      return;
    }
    running = true;
    error = null;
    const res = await sql.run({ setup: writeSetup, sql: text, verify: wc.verify ?? undefined });
    running = false;
    // The engine or the card is at fault, not the query: say so, and don't count it.
    if (!res.ok && (res.stage === 'engine' || res.stage === 'setup')) {
      error = res.error;
      return;
    }
    let attempt: Attempt;
    if (!res.ok) {
      attempt = { kind: 'error', sql: text, message: res.error };
    } else {
      const v = compareResults(res.table, target, wOrdered);
      attempt = v.ok ? { kind: 'right', sql: text, table: res.table } : { kind: 'wrong', sql: text, table: res.table, verdict: v };
    }
    attempts = [...attempts, attempt];
    if (!writeGraded) {
      writeGraded = true;
      await settle(attempt.kind === 'right' && !hinted ? 'good' : 'again');
    }
    if (attempt.kind !== 'right') {
      await tick();
      area?.focus();
    }
  }

  /** The code that is already in place on a Go/C++ card, if the card has any. */
  const given = (c: { given: string | null }): string | null => c.given?.trim() ? c.given : null;

  const writeLangOf = (c: CardRef): string => {
    const day = findDay(c.dayId);
    return (day && findWrite(day, c.questionId)?.set.lang) ?? 'sql';
  };

  /** A write challenge, from the day's own file or its practice bank. */
  function findWrite(day: Day, id: string | undefined): { set: WriteSet; c: WriteChallenge } | null {
    for (const set of [day.write, day.practice?.write]) {
      const c = set?.challenges.find((x) => x.id === id);
      if (set && c) return { set, c };
    }
    return null;
  }

  function findDrill(day: Day, id: string | undefined): DrillStep | null {
    return day.drill?.find((x) => x.id === id) ?? day.practice?.drill.find((x) => x.id === id) ?? null;
  }

  /**
   * Judge a Go/C++ answer. Nothing is run, so nothing can go wrong with the engine and the
   * first check always counts: right with no hint is a pass, anything else is a miss, and
   * fixing it afterwards is free.
   */
  async function checkShape() {
    const code = writeSql.trim();
    const set = writeHit?.set;
    if (!code || solved || revealed || !wc || !set || set.lang === 'sql') return;
    let report: ShapeReport;
    try {
      report = judge(code, set.lang, { requires: wc.requires, forbids: wc.forbids }, set.defs);
    } catch (err) {
      // A broken pattern is the card file's bug, not the learner's wrong answer.
      console.error(`[write] ${card?.id}: ${err instanceof Error ? err.message : err}`);
      error = 'This card is broken — it has been left out of your score.';
      if (card) await setAside(card);
      return;
    }
    shapeTries = [...shapeTries, { code, report }];
    if (!writeGraded) {
      writeGraded = true;
      await settle(report.ok && !hinted ? 'good' : 'again');
    }
    if (!report.ok) {
      await tick();
      area?.focus();
    }
  }

  /** Giving up is a miss — but it ends the card with the answer on the screen. */
  async function showAnswer() {
    if (revealed || solved) return;
    revealed = true;
    if (!writeGraded) {
      writeGraded = true;
      await settle('again');
    }
  }

  /** information_schema's long type names, the way a person writes them in a CREATE TABLE. */
  const SHORT: Record<string, string> = {
    integer: 'int',
    'double precision': 'float8',
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    'character varying': 'varchar',
    boolean: 'bool',
  };
  const shortType = (t: string) => SHORT[t] ?? t;

  /** What was wrong with a result, in a sentence. */
  function whyWrong(v: Exclude<Verdict, { ok: true }>): string {
    if (v.reason === 'columns') {
      return `Your query returns ${v.got} column${v.got === 1 ? '' : 's'}; the target has ${v.want}.`;
    }
    if (v.reason === 'order') return 'Right rows, wrong order — this answer is sorted.';
    const parts: string[] = [];
    if (v.missing.length) parts.push(`${v.missing.length} row${v.missing.length === 1 ? '' : 's'} of the target ${v.missing.length === 1 ? 'is' : 'are'} missing`);
    if (v.extra.length) parts.push(`${v.extra.length} row${v.extra.length === 1 ? '' : 's'} ${v.extra.length === 1 ? "shouldn't" : "shouldn't"} be there`);
    return `${parts.join(', and ')}.`;
  }

  /** Shuffle a block's lines. A shuffle that changes nothing isn't a puzzle. */
  function setupParsons(ref: CardRef) {
    const day = findDay(ref.dayId);
    // Looked up by the block's own key rather than its position, so a card dealt before
    // a lesson was edited still finds the block it was actually about — or finds nothing
    // and is skipped, which is the honest outcome once that block is gone.
    const block = day ? codeBlocksFor(day, lang).find((b) => b.key === ref.questionId) : undefined;
    if (!block) return;
    const lines = block.lines;
    solution = lines;
    built = [];
    let shuffled = lines;
    for (let i = 0; i < 8 && shuffled.join('\n') === lines.join('\n'); i++) {
      shuffled = [...lines].sort(() => Math.random() - 0.5);
    }
    bank = shuffled;
  }

  const findDay = (dayId: string): Day | undefined =>
    app.weeks.flatMap((w) => w.days).find((d) => d.id === dayId);

  function take(i: number) {
    if (checked) return;
    built = [...built, bank[i]];
    bank = bank.filter((_, j) => j !== i);
  }

  function drop(i: number) {
    if (checked) return;
    bank = [...bank, built[i]];
    built = built.filter((_, j) => j !== i);
  }

  const parsonsRight = $derived(built.join('\n') === solution.join('\n'));

  async function checkParsons() {
    if (checked || built.length !== solution.length) return;
    checked = true;
    await settle(parsonsRight ? 'good' : 'again');
  }

  /** Ask the model for a challenge it has just invented from the day's material. */
  async function forge() {
    const key = app.mentorKey;
    if (!key || !context) return;
    loading = true;
    error = null;
    try {
      // A challenge is shown whole, as a question, so half of one is worse than none —
      // and Gemini can cut a reply mid-sentence while still reporting a clean finish.
      // Nothing is on screen yet, so an unfinished one is quietly asked for again.
      let text = '';
      for (let attempt = 1; attempt <= 2 && !looksComplete(text); attempt++) {
        text = await collect(
          streamReply({
            provider: app.mentorProvider,
            key,
            model: app.progress.settings.mentorModel,
            alternates: app.fallbackModels,
            system: forgePrompt(context),
            messages: [{ role: 'user', content: 'Write the challenge.' }],
          }),
        );
      }
      // Twice unfinished: the day's stored teach-back question is a real question
      // about the same material, which beats a card that stops mid-word.
      if (!looksComplete(text)) text = context.day.teachBack ?? '';
      if (!text) throw new Error('The model could not finish a challenge. Skip this one, or try again.');
      challenge = text;
    } catch (err) {
      if (err instanceof ModelGoneError) await app.retireModel(app.progress.settings.mentorModel);
      error = err instanceof Error ? err.message : 'Could not write a challenge.';
    } finally {
      loading = false;
    }
  }

  /** The data a generated SQL challenge is about, shown with it so the question is answerable. */
  const forgeTables = $derived(
    card?.kind === 'forge' && context ? forgeData(context.week.track as Track | undefined, context.day) : null,
  );

  const prompt = $derived(
    card?.kind === 'forge' ? challenge : (context?.day.teachBack ?? ''),
  );

  /**
   * Say something to the marker. Every message goes to the same conversation, so a
   * follow-up question is answered in place rather than by overwriting the last answer.
   *
   * `preset` is a message that is not typed: "I don't know" is an ordinary message that
   * starts the hint ladder, not a separate path that skips to the answer.
   */
  async function submit(preset?: string) {
    const raw = (preset ?? answer).trim();
    const key = app.mentorKey;
    if (!raw || !key || !context || streaming || verdict) return;
    const text = preset === undefined && codeMode && !hasFence(raw) ? asCodeBlock(raw, lang) : raw;

    streaming = true;
    error = null;
    const before = $state.snapshot(turns) as ChatMessage[];
    const sent: ChatMessage[] = [...before, { role: 'user', content: text }];
    const at = sent.length;
    turns = [...sent, { role: 'assistant', content: '' }];
    answer = '';
    codeMode = false;
    try {
      for await (const chunk of streamReply({
        provider: app.mentorProvider,
        key,
        model: app.progress.settings.mentorModel,
        alternates: app.fallbackModels,
        system: reviewGraderPrompt(context, prompt, sent),
        messages: withStanding(sent),
      })) {
        turns[at].content += chunk;
      }
      // The last allowed message always ends the card, whatever the model did: a
      // conversation with no ruling is a card you can never leave.
      const lastAllowed = sent.filter((m) => m.role === 'user').length >= MAX_REVIEW_MESSAGES;
      let ruling = parseVerdict(turns[at].content);
      if (!ruling && lastAllowed) {
        // It ignored the last-message note and asked something anyway. The card is over
        // regardless, so say so instead of leaving a question nobody can answer.
        ruling = 'gaps';
        turns[at].content +=
          '\n\n_That was your last reply on this card, so it is marked to come back soon. Tap **Ask** to keep talking it through._';
      }
      if (ruling) {
        verdict = ruling;
        await settle(ruling === 'solid' ? 'good' : 'again');
      }
    } catch (err) {
      if (err instanceof ModelGoneError) await app.retireModel(app.progress.settings.mentorModel);
      error = err instanceof Error ? err.message : 'The mentor is unavailable.';
      // Nothing came of it: take the exchange back and give them their words again.
      turns = before;
      answer = raw;
    } finally {
      streaming = false;
    }
    if (!verdict) {
      await tick();
      area?.focus();
    }
  }

  async function choose(index: number) {
    if (picked !== null || !question) return;
    picked = index;
    await settle(question.options[index]?.correct ? 'good' : 'again');
  }

  async function settle(result: 'good' | 'again') {
    if (!card) return;
    // "Early" is a property of the card, not of the mode: a practice run can still
    // turn up something that was genuinely due, and that one counts in full.
    const early = !isDue(app.progress.review.cards[card.id], today());
    seen = new Set([...seen, card.id]);
    await app.gradeCard(card.id, result, early);
    if (roundCards && roundCtx && card.dayId === roundCtx.day.id) {
      if (result === 'good') roundRight++;
      await app.recordPractice(roundCtx.day, roundCtx.week.id, card, result === 'good');
    }
  }

  /** Start a round of the given day's bank. */
  function startRound() {
    if (!roundCtx) return;
    roundCards = buildRound(roundCtx.day, app.progress.days[roundCtx.day.id]?.practice);
    roundAt = 0;
    roundRight = 0;
    roundDone = null;
    seen = new Set();
    void deal();
  }

  /** Next item of the round. A card set aside (it could not be set up) is not counted. */
  async function nextInRound() {
    roundAt++;
    await deal();
  }

  async function endRound() {
    if (!roundCards || !roundCtx || roundDone) return;
    const asked = roundCards.filter((c) => seen.has(c.id)).length;
    const state = await app.finishPracticeRound(roundCtx.day, roundCtx.week.id, asked, roundRight);
    roundDone = { asked, right: roundRight, landed: Boolean(state.landedAt) };
  }

  /** Grade an ungradeable card as a miss rather than letting it silently vanish. */
  async function skip() {
    await settle('again');
    await advance();
  }

  /** On to the next card: the round's next item, or whatever the deck deals. */
  function advance() {
    return roundCards ? nextInRound() : deal();
  }

  // M does what the Ask button does, and only when it would show: once the card is
  // answered. Before that the mentor would be the answer key.
  mentorKey(() => ({
    canOpen: () => answered && Boolean(context) && app.mentorReady,
    open: () => (asking = true),
    close: () => (asking = false),
    isOpen: () => asking,
    focus: focusComposer,
  }));

  // 1–4 pick an answer on a quiz card; N or Enter deals the next card once it is answered.
  answerKeys(() => ({
    count: () => question?.options.length ?? 0,
    canChoose: () => (card?.kind === 'quiz' || card?.kind === 'drill') && Boolean(question) && picked === null && !loading,
    choose: (i) => void choose(i),
    canAdvance: () => answered && !streaming && !running,
    advance: () => void advance(),
  }));

  $effect(() => {
    if (!app.ready || card || seen.size) return;
    if (roundDay) {
      if (!roundCards && roundCtx) untrack(startRound);
    } else void deal();
  });

  // Let the engine go when the deck is left: it is the heaviest thing the app ever holds.
  $effect(() => () => sql.release());

  // The engine is a few MB and takes a few seconds to start, so start it as the deck opens
  // rather than when the first write card is dealt. After the first time it comes from cache.
  $effect(() => {
    if (app.ready && app.deck.some((c) => c.kind === 'write' && writeLangOf(c) === 'sql')) void sql.warm();
  });

  // Opening the deck spends the day's interruption, however it was reached.
  $effect(() => {
    if (app.ready && app.ambush) void app.noteAmbush();
  });
</script>

<div class="screen">
  <header>
    <button class="back" onclick={() => router.go('/today')} aria-label="Back">
      <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <div>
      <p class="lbl">{roundDay ? 'Practice round' : 'Review'}</p>
      <p class="ctx">
        {#if roundDay}{roundCtx?.day.title ?? ''}{#if roundCards && !roundDone}{' · '}{Math.min(roundAt + 1, roundCards.length)} of {roundCards.length}{/if}
        {:else if practice}Practice{:else if remaining > 0}{remaining} due{:else}Nothing due — this one's a bonus{/if}
        {#if app.clearedToday && !roundDay}· {app.clearedToday} cleared today{/if}
      </p>
    </div>
  </header>

  {#if roundDay && roundDone && roundCtx}
    {@const st = practiceStatus(roundCtx.day, app.progress.days[roundCtx.day.id]?.practice)}
    <div class="empty card roundend" class:landed={roundDone.landed}>
      <p class="score numeral">{roundDone.right}<span>/{roundDone.asked}</span></p>
      <h2>{roundDone.landed ? 'Landed.' : 'Not landed yet.'}</h2>
      <p>
        {#if roundDone.landed}
          Right first time on {roundDone.right} of {roundDone.asked}. {roundCtx.day.title} has landed, and the
          next lesson is open. Everything you met in this set stays in your review deck.
        {:else if roundDone.asked < MIN_ROUND}
          A round needs at least {MIN_ROUND} questions to count towards landing.
        {:else}
          Right first time on {roundDone.right} of {roundDone.asked}; it lands at {Math.round(LAND_AT * 100)}% on a
          round. {st.fresh ? `${st.fresh} questions in this set you haven't seen yet.` : `You've seen the whole set — the next round goes back over the ${st.missed} you missed.`}
        {/if}
      </p>
      <div class="pair">
        {#if !roundDone.landed}
          <Button size="sm" onclick={startRound}>Another round</Button>
        {/if}
        <Button variant={roundDone.landed ? 'primary' : 'ghost'} size="sm" onclick={() => router.go('/today')}>Back to today</Button>
      </div>
      {#if !roundDone.landed && !st.movedOn}
        <button class="link" onclick={async () => { await app.moveOn(roundCtx!.day, roundCtx!.week.id); router.go('/today'); }}>
          Move on to the next lesson anyway
        </button>
      {/if}
    </div>
  {:else if roundDay && !roundCtx}
    <div class="empty card">
      <h2>That practice set isn't here</h2>
      <p>The lesson it belongs to hasn't loaded on this device yet.</p>
      <Button size="sm" onclick={() => router.go('/today')}>Back to today</Button>
    </div>
  {:else if roundDay && !card}
    <div class="card wait"><span class="dot"></span>Dealing the round…</div>
  {:else if !answerable.length}
    <div class="empty card">
      <h2>Nothing to review yet</h2>
      <p>
        Cards appear once you've finished a day's quiz. Come back after a lesson or two
        and this fills up on its own.
      </p>
      <Button size="sm" onclick={() => router.go('/today')}>Back to today</Button>
    </div>
  {:else if !card && practice && seen.size}
    <!-- Practice used to start the deck over from the top here, which is how the same
         dozen cards came round again and again. It stops instead, and points at the
         practice set, which is where fresh questions on the same ground come from. -->
    <div class="empty card">
      <h2>That's every card</h2>
      <p>
        You've been through all {seen.size} cards in your deck this sitting. Going round again would
        only be remembering the answers you just gave.
      </p>
      {#if app.practising}
        <p class="fine">Fresh questions on {app.practising.day.title} are in its practice set.</p>
        <div class="pair">
          <Button size="sm" onclick={() => router.go(`/review/round/${app.practising!.day.id}`)}>Practise {app.practising.day.title}</Button>
          <Button variant="ghost" size="sm" onclick={() => router.go('/today')}>Back to today</Button>
        </div>
      {:else}
        <Button size="sm" onclick={() => router.go('/today')}>Back to today</Button>
      {/if}
    </div>
  {:else if !card}
    <div class="empty card">
      <h2>Deck's clear</h2>
      <p>
        Everything due has been answered. The rest is resting — cards come back on a
        widening interval, and sooner if you missed them.
      </p>
      <p class="fine">
        You can keep going anyway. Answering early won't push a card further out, so
        extra practice can only sharpen the schedule, never flatter it.
      </p>
      <div class="pair">
        <Button size="sm" onclick={() => { practice = true; void deal(); }}>
          Keep practising
        </Button>
        <Button variant="ghost" size="sm" onclick={() => router.go('/today')}>Back to today</Button>
      </div>
    </div>
  {:else}
    <p class="from">
      {#if context}Day {context.day.day} — {context.day.title}{/if}
      <span class="kind">
        {#if card.kind === 'quiz'}from the quiz
        {:else if card.kind === 'drill'}{question && 'kind' in question ? ({ predict: 'predict it', find: 'find the bug', choose: 'choose' } as Record<string, string>)[question.kind] ?? 'drill' : 'drill'}
        {:else if card.kind === 'explain'}explain it
        {:else if card.kind === 'parsons'}rebuild it
        {:else if card.kind === 'write'}write it
        {:else}fresh challenge{/if}
      </span>
    </p>

    {#if loading}
      <div class="card wait">
        <span class="dot"></span>
        {card.kind === 'write' ? 'Starting PostgreSQL — it runs on this device…' : 'Writing you a challenge…'}
      </div>
      {#if card.kind === 'write'}
        <p class="fine">The first time this downloads about 5 MB. After that it starts from the device.</p>
        <button class="link" onclick={() => card && void setAside(card)}>Skip this card</button>
      {/if}
    {:else if (card.kind === 'quiz' || card.kind === 'drill') && question}
      <div class="card">
        <h2 class="q inline-md">{@html inlineHtml(question.prompt)}</h2>
        {#if listing}
          <pre class="ref listing"><code>{@html highlight(listing, wLangOfDay)}</code></pre>
        {/if}
        <div class="options">
          {#each question.options as option, i}
            <button
              class="option"
              class:right={answered && option.correct}
              class:wrong={picked === i && !option.correct}
              disabled={picked !== null}
              onclick={() => void choose(i)}
            >
              <span class="text inline-md">{@html inlineHtml(option.text)}</span>
              {#if answered && option.correct}<span class="mark">✓</span>{/if}
              {#if picked === i && !option.correct}<span class="mark">✗</span>{/if}
            </button>
            {#if answered && (picked === i || option.correct)}
              <p class="why inline-md" class:muted={picked !== i}>{@html inlineHtml(option.why)}</p>
            {/if}
          {/each}
        </div>
      </div>
    {:else if card.kind === 'write' && wc && shaped}
      <div class="card">
        <h2 class="q inline-md">{@html inlineHtml(wc.prompt)}</h2>
        {#if given(wc)}
          <p class="sub">What you already have:</p>
          <pre class="ref given"><code>{@html highlight(given(wc)!, wLang)}</code></pre>
        {/if}
        {#if hinted && wc.hint}
          <p class="hint"><strong>Hint.</strong> {@html inlineHtml(wc.hint)}</p>
        {/if}
      </div>

      {#if !solved && !revealed}
        <div class="answer">
          <CodeArea
            bind:this={area}
            bind:value={writeSql}
            bind:codeMode
            lang={wLang}
            placeholder="Write it from memory…"
            ariaLabel="Your code"
            maxHeight={260}
            onsubmit={() => void runWrite()}
          />
        </div>
        <p class="fine">
          {shapeTries.length ? 'Fix it and check again — only the first check counts towards the schedule.' : 'The first check counts. Ctrl/Cmd+Enter checks it.'}
        </p>
      {/if}

      {#each shapeTries.slice(-1) as t}
        <div class="card try" class:right={t.report.ok} class:wrong={!t.report.ok}>
          <p class="verdict">{t.report.ok ? '✓ That has everything this card looks for.' : '✗ Not quite yet.'}</p>
          <ul class="checks">
            {#each t.report.items as it}
              <li class:okk={it.ok}>
                <span class="tick">{it.ok ? '✓' : '✗'}</span>
                <span>{#if it.kind === 'forbid'}Shouldn't have: {/if}{it.say}</span>
              </li>
            {/each}
          </ul>
          <p class="fine">
            Judged by shape: it checks the right pieces are there, in the right places. It doesn't run your code, so a
            plausible answer can still be wrong — and a valid one the card didn't expect can be marked short.
          </p>
        </div>
      {/each}

      {#if answered}
        <div class="card">
          <p class="lbl2">{solved ? 'The reference answer — yours may differ and still be right' : 'The answer'}</p>
          <pre class="ref"><code>{@html highlight(wc.solution, wLang)}</code></pre>
          {#if wc.note}<p class="note inline-md">{@html inlineHtml(wc.note)}</p>{/if}
        </div>
      {/if}
    {:else if card.kind === 'write' && wc && target}
      <div class="card">
        <h2 class="q inline-md">{@html inlineHtml(wc.prompt)}</h2>

        {#if tables}
          <div class="schema">
            {#each tables as t}
              <p><strong>{t.name}</strong>({t.columns.map((c) => `${c.name} ${shortType(c.type)}`).join(', ')})</p>
            {/each}
          </div>
          <details class="data">
            <summary>Sample data</summary>
            {#each tables as t}
              <p class="tname">{t.name} · {t.rowCount} row{t.rowCount === 1 ? '' : 's'}</p>
              <ResultGrid columns={t.columns.map((c) => c.name)} rows={t.rows} limit={8} caption={t.name} />
            {/each}
          </details>
        {/if}

        <p class="sub">Your query should return{wOrdered ? ' (in this order)' : ''}:</p>
        <ResultGrid columns={target.columns} rows={target.rows} caption="The target result" />

        {#if hinted && wc.hint}
          <p class="hint"><strong>Hint.</strong> {wc.hint}</p>
        {/if}
      </div>

      {#if !solved && !revealed}
        <div class="answer">
          <CodeArea
            bind:this={area}
            bind:value={writeSql}
            bind:codeMode
            lang="sql"
            placeholder="Write the query from memory…"
            ariaLabel="Your query"
            maxHeight={220}
            onsubmit={() => void runWrite()}
          />
        </div>
        <p class="fine">
          {attempts.length ? 'Fix it and run it again — only the first run counts towards the schedule.' : 'The first run counts. Ctrl/Cmd+Enter runs it.'}
        </p>
      {/if}

      {#each attempts.slice(-1) as a}
        <div class="card try" class:right={a.kind === 'right'} class:wrong={a.kind !== 'right'}>
          {#if a.kind === 'right'}
            <p class="verdict">✓ That returns the target.</p>
          {:else if a.kind === 'error'}
            <p class="verdict">{a.ruled ? '✗ Not this way.' : '✗ PostgreSQL says:'}</p>
            <pre class="pgerr">{a.message}</pre>
          {:else}
            <p class="verdict">✗ Not quite. {whyWrong(a.verdict)}</p>
          {/if}
          {#if a.kind !== 'error'}
            <ResultGrid
              columns={a.table.columns}
              rows={a.table.rows}
              mark={a.kind === 'wrong' && a.verdict.reason === 'rows' ? new Set(a.verdict.extra.map((r) => JSON.stringify(r))) : undefined}
              caption="What your query returned"
            />
          {/if}
        </div>
      {/each}

      {#if answered}
        <div class="card">
          <p class="lbl2">{solved ? 'The reference answer — yours may differ and still be right' : 'The answer'}</p>
          <pre class="ref"><code>{@html highlight(wc.solution, 'sql')}</code></pre>
        </div>
      {/if}
    {:else if card.kind === 'parsons'}
      <div class="card">
        <h2 class="q">Put this back in order</h2>
        <p class="sub">Tap the lines in the order they ran. Tap one you've placed to take it back.</p>

        <ol class="built" class:right={checked && parsonsRight} class:wrong={checked && !parsonsRight}>
          {#each built as line, i}
            <li>
              <button onclick={() => drop(i)} disabled={checked}>
                <code
                  class:bad={checked && solution[i] !== line}
                >{@html highlight(line, lang)}</code>
              </button>
            </li>
          {:else}
            <li class="ghost">Nothing placed yet</li>
          {/each}
        </ol>

        {#if bank.length}
          <div class="bank">
            {#each bank as line, i}
              <button onclick={() => take(i)} disabled={checked}>
                <code>{@html highlight(line, lang)}</code>
              </button>
            {/each}
          </div>
        {/if}

        {#if checked && !parsonsRight}
          <p class="sub">The order it actually runs in:</p>
          <ol class="built shown">
            {#each solution as line}
              <li><code>{@html highlight(line, lang)}</code></li>
            {/each}
          </ol>
        {/if}
      </div>
    {:else if graded}
      <div class="card">
        {#if prompt}
          {#if forgeTables}
            <details class="tables" open>
              <summary>The tables this is about</summary>
              <pre class="ref"><code>{@html highlight(forgeTables, 'sql')}</code></pre>
            </details>
          {/if}
          <div class="q"><Markdown source={prompt} /></div>
        {:else}
          <p class="q">This card needs the mentor, and it isn't reachable right now.</p>
        {/if}
      </div>

      {#each turns as turn, i}
        {#if turn.role === 'user'}
          {@const shape = shapeOf(turn.content)}
          <div class="mine">
            <div class="bubble" class:has-code={shape === 'code'} class:mixed={shape === 'mixed'}>
              {#if shape === 'text'}{turn.content}{:else}<Markdown source={turn.content} />{/if}
            </div>
          </div>
        {:else}
          {@const ruled = verdict !== null && i === turns.length - 1}
          <div class="card grade" class:solid={ruled && verdict === 'solid'} class:gaps={ruled && verdict === 'gaps'}>
            <Markdown source={stripMarkers(turn.content)} />
            {#if streaming && i === turns.length - 1}<span class="caret"></span>{/if}
          </div>
        {/if}
      {/each}

      {#if prompt && !verdict}
        <div class="answer">
          <CodeArea
            bind:this={area}
            bind:value={answer}
            bind:codeMode
            placeholder={turns.length ? 'Reply to the mentor…' : 'From memory — no looking it up…'}
            ariaLabel={turns.length ? 'Your reply' : 'Your answer'}
            maxHeight={180}
            onsubmit={() => void submit()}
            enterSends
          />
        </div>
        {#if lastChance}
          <p class="fine lastchance">Last reply on this card — the mentor rules on it after this one.</p>
        {/if}
      {/if}
    {/if}

    {#if error}
      <div class="err">
        <p>{error}</p>
        <button class="link" onclick={() => (card?.kind === 'write' ? void setAside(card) : void skip())}>Skip this card</button>
      </div>
    {/if}

    <div class="actions">
      {#if answered}
        <Button onclick={() => void advance()}>{roundCards && roundAt + 1 >= roundCards.length ? 'Finish the round' : 'Next card'}</Button>
        <Button variant="ghost" size="sm" onclick={() => router.go('/today')}>Done for now</Button>
      {:else if card.kind === 'parsons'}
        <Button onclick={() => void checkParsons()} disabled={built.length !== solution.length}>
          Check
        </Button>
        <Button variant="ghost" size="sm" onclick={() => void skip()}>Skip</Button>
      {:else if card.kind === 'write' && wc && (target || shaped)}
        <Button onclick={() => void runWrite()} disabled={!writeSql.trim() || running}>
          {running ? 'Running…' : shaped ? 'Check ▶' : 'Run ▶'}
        </Button>
        {#if wc.hint && !hinted}
          <Button variant="ghost" size="sm" onclick={() => (hinted = true)}>Hint</Button>
        {/if}
        <Button variant="ghost" size="sm" disabled={running} onclick={() => void showAnswer()}>Show answer</Button>
      {:else if graded && prompt}
        <Button onclick={() => void submit()} disabled={!answer.trim() || streaming}>
          {streaming ? 'Thinking…' : turns.length ? 'Reply' : 'Submit'}
        </Button>
        <Button variant="ghost" size="sm" disabled={streaming} onclick={() => void submit("I don't know.")}>
          I don't know
        </Button>
      {/if}
    </div>
  {/if}
</div>

<!-- Deliberately only once the card is answered. Before that the mentor is simply the
     answer key, and a card you looked up has measured nothing. Afterwards it's the most
     useful moment in the whole deck: you have just found out you were wrong. -->
{#if answered && context && app.mentorReady}
  <button class="ask" onclick={() => (asking = true)} aria-label="Ask the mentor about this card">
    <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5.5A8 8 0 1 1 21 12z" /></svg>
    <span>Ask</span>
  </button>
{/if}

{#if context}
  <MentorSheet
    week={context.week}
    day={context.day}
    open={asking}
    onclose={() => (asking = false)}
    {suggestions}
    {focus}
    thread={card ? `review:${card.id}` : undefined}
  />
{/if}

<style>
  .fine {
    font-size: 13px !important;
    color: var(--text-faint) !important;
  }

  .pair {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sub {
    font-size: 13.5px;
    color: var(--text-faint);
    line-height: 1.5;
    margin: 10px 0 12px;
  }

  /* Two stacks: the program you're building, and the shuffled lines left to place.
     Tapping rather than dragging — dragging a code line on a phone fights the scroll. */
  .built,
  .bank {
    list-style: none;
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
  }

  .built {
    border: 1px dashed var(--border);
    border-radius: 12px;
    padding: 8px;
    min-height: 54px;
  }

  .built.right {
    border-style: solid;
    border-color: var(--ok);
  }

  .built.wrong {
    border-style: solid;
    border-color: var(--bad);
  }

  .built.shown {
    border-style: solid;
    margin-top: 4px;
  }

  .bank {
    margin-top: 12px;
  }

  .built li.ghost {
    font-size: 13px;
    color: var(--text-faint);
    padding: 6px 4px;
  }

  /* Grid items default to min-width:auto, so a long line pushes the whole row past
     the card instead of scrolling inside it. */
  .built li,
  .bank button,
  .built button {
    min-width: 0;
  }

  .built button,
  .bank button {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 8px 10px;
  }

  .bank button {
    background: var(--bg-elev, var(--surface-2));
  }

  .built code,
  .bank code {
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre;
    overflow-x: auto;
    display: block;
    color: var(--text);
  }

  /* Only the lines that are actually in the wrong slot get marked. */
  .built code.bad {
    color: var(--bad);
  }

  /* Clears the tab bar: unlike the session screens, this one keeps it. */
  .ask {
    position: fixed;
    right: 16px;
    bottom: calc(var(--tab-h) + var(--safe-b) + 16px);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 15px 10px 13px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink, #fff);
    font-size: 14.5px;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  }

  .ask svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .screen {
    padding-bottom: calc(var(--tab-h) + var(--safe-b) + 24px);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 18px;
  }

  .back {
    padding: 2px 4px 0 0;
    color: var(--text-faint);
  }

  .back svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .lbl {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .ctx {
    font-size: 14.5px;
    font-weight: 600;
    margin-top: 2px;
  }

  .from {
    font-size: 13px;
    color: var(--text-faint);
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .kind {
    flex: none;
    font-weight: 600;
    color: var(--accent);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px;
    margin-bottom: 14px;
  }

  .empty h2 {
    font-size: 18px;
    margin-bottom: 8px;
  }

  .empty p {
    font-size: 14.5px;
    line-height: 1.55;
    color: var(--text-dim);
    margin-bottom: 14px;
  }

  h2.q,
  p.q {
    font-size: 16.5px;
    line-height: 1.45;
    font-weight: 600;
  }

  .options {
    display: grid;
    gap: 9px;
    margin-top: 14px;
  }

  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 14.5px;
    line-height: 1.4;
  }

  .option:disabled {
    opacity: 1;
  }

  .option.right {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }

  .option.wrong {
    border-color: var(--bad);
    background: color-mix(in srgb, var(--bad) 12%, transparent);
  }

  .mark {
    flex: none;
    font-weight: 700;
  }

  /* The explanation is the part that teaches, so the one for the option actually
     picked stays at full strength even when it's the wrong one. */
  .why {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-dim);
    padding: 0 4px 4px;
  }

  .why.muted {
    opacity: 0.7;
  }

  .answer {
    display: flex;
    margin-bottom: 14px;
  }

  .lastchance {
    margin: -6px 4px 14px;
  }

  /* What you said, as a chat bubble: right-aligned, so the exchange reads as a
     conversation and the mentor's replies stay in the cards. */
  .mine {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
  }

  .bubble {
    background: var(--accent-soft);
    border-radius: 15px 15px 4px 15px;
    padding: 9px 12px;
    font-size: 15px;
    max-width: 88%;
    white-space: pre-wrap;
  }

  .bubble.has-code {
    max-width: 100%;
    width: 100%;
    background: transparent;
    padding: 0;
  }

  .bubble.mixed {
    background: var(--surface);
    border: 1px solid var(--border);
    max-width: 100%;
    width: 100%;
  }

  .grade {
    margin-bottom: 12px;
  }

  .grade.solid {
    border-color: var(--ok);
  }

  .grade.gaps {
    border-color: var(--flame, var(--bad));
  }

  .wait {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14.5px;
    color: var(--text-dim);
  }

  .dot,
  .caret {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }

  .caret {
    border-radius: 2px;
    height: 14px;
    vertical-align: -2px;
  }

  @keyframes pulse {
    50% { opacity: 0.25; }
  }

  .err {
    background: var(--bad-soft, color-mix(in srgb, var(--bad) 12%, transparent));
    border-radius: 12px;
    padding: 11px 13px;
    font-size: 13.5px;
    margin-bottom: 14px;
  }

  .link {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    margin-top: 4px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
    /* Room for the floating Ask pill, which sits over this corner. */
    padding-bottom: 56px;
  }
  /* Write card */
  .schema {
    margin: 12px 0 4px;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.55;
  }

  .schema p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .data summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    margin: 8px 0;
  }

  .tname {
    margin: 10px 0 5px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-faint);
  }

  .hint {
    margin: 14px 0 0;
    padding: 9px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    font-size: 13.5px;
    line-height: 1.5;
  }

  .try {
    border-left: 4px solid var(--border);
  }

  .try.right {
    border-left-color: var(--ok);
  }

  .try.wrong {
    border-left-color: var(--bad);
  }

  .verdict {
    margin: 0 0 10px;
    font-weight: 600;
    font-size: 14.5px;
  }

  .pgerr {
    margin: 0;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    color: var(--bad);
  }

  .lbl2 {
    margin: 0 0 8px;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.075em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .listing {
    margin: 10px 0 2px;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--surface-2);
  }

  .listing code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .roundend .score {
    margin: 0;
    font-size: 44px;
    font-weight: 800;
    line-height: 1;
  }

  .roundend .score span {
    font-size: 22px;
    color: var(--text-faint);
  }

  .roundend.landed .score {
    color: var(--ok);
  }

  .roundend .link {
    margin-top: 12px;
  }

  .tables {
    margin: 0 0 12px;
  }

  .tables summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 8px;
  }

  .tables .ref {
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--surface-2);
    max-height: 260px;
    overflow: auto;
    font-size: 12.5px;
  }

  .given code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .given {
    margin: 4px 0 0;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--surface-2);
  }

  .checks {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 14px;
    line-height: 1.45;
  }

  .checks li {
    display: flex;
    gap: 8px;
    color: var(--bad);
  }

  .checks li.okk {
    color: var(--text);
  }

  .checks .tick {
    flex: none;
    width: 1.1em;
    font-weight: 700;
  }

  .checks li.okk .tick {
    color: var(--ok);
  }

  .note {
    margin: 12px 0 0;
    font-size: 14px;
    line-height: 1.55;
    color: var(--text-dim, var(--text));
  }

  .ref {
    margin: 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
  }
</style>
