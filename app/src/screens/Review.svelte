<script lang="ts">
  /**
   * The review deck: old material, dealt back at you.
   *
   * Three kinds of card, deliberately mixed so a session never settles into a rhythm.
   * A quiz card is one you already answered weeks ago, replayed from the stored bank —
   * it needs no network and no key, which is what keeps the deck usable on a train. A
   * teach-back card asks you to explain a mechanism and is graded. A forged card is
   * written fresh by the model from that day's material, so it is one you have provably
   * never seen; those are the ones that catch you.
   *
   * Nothing here is a gate. You can walk away mid-card and the ones you cleared stay
   * cleared, because a review system you can't quit is one you start avoiding.
   */
  import { untrack } from 'svelte';
  import { app } from '../lib/app.svelte';
  import { router } from '../lib/router.svelte';
  import Button from '../components/Button.svelte';
  import Markdown from '../components/Markdown.svelte';
  import { highlight } from '../lib/markdown';
  import CodeArea from '../components/CodeArea.svelte';
  import MentorSheet from '../components/MentorSheet.svelte';
  import { codeBlocksFor, isDue, pickNext, type CardRef } from '../lib/review';
  import { today } from '../lib/date';
  import {
    collect, forgePrompt, parseVerdict, reviewGraderPrompt, streamReply, stripVerdict,
    examinerPrompt, ModelGoneError, type ChatMessage,
  } from '../lib/mentor';
  import type { Day, QuizQuestion, Week } from '../lib/types';

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
  let { practice: startInPractice = false }: { practice?: boolean } = $props();
  // Seed only. After that it's a local toggle: arriving via /review/practice starts you
  // in practice, but finishing the due cards and tapping "Keep practising" must be able
  // to flip it on without the URL disagreeing.
  let practice = $state(untrack(() => startInPractice));

  // Parsons card: reorder the shuffled lines of a real block from the lesson.
  let bank = $state<string[]>([]);
  let built = $state<string[]>([]);
  let solution = $state<string[]>([]);
  let checked = $state(false);

  // Graded cards.
  let challenge = $state('');
  let answer = $state('');
  let codeMode = $state(false);
  let reply = $state('');
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

  const question = $derived.by((): QuizQuestion | null => {
    if (card?.kind !== 'quiz' || !context) return null;
    return context.day.quiz?.find((q) => q.id === card!.questionId) ?? null;
  });

  /** Graded cards need the mentor; without a key the deck falls back to quiz cards. */
  const graded = $derived(card?.kind === 'explain' || card?.kind === 'forge');
  const answerable = $derived(
    app.deck.filter((c) => c.kind === 'quiz' || c.kind === 'parsons' || app.mentorReady),
  );

  const remaining = $derived(app.dueNow.filter((c) => !seen.has(c.id)).length);
  const answered = $derived(picked !== null || verdict !== null || checked);

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
    reply = '';
    verdict = null;
    error = null;
  }

  async function deal() {
    reset();
    // In practice mode nothing is "due", so every card is fair game; `seen` still
    // stops the same one coming round twice in a sitting.
    const on = practice ? '9999-12-31' : today();
    const next = pickNext(answerable, app.progress.review, on, Math.random, seen);
    card = next;
    if (next?.kind === 'forge') await forge();
    if (next?.kind === 'parsons') setupParsons(next);
  }

  /** Shuffle a block's lines. A shuffle that changes nothing isn't a puzzle. */
  function setupParsons(ref: CardRef) {
    const day = findDay(ref.dayId);
    const block = day ? codeBlocksFor(day)[Number(ref.questionId ?? 0)] : undefined;
    if (!block) return;
    solution = block;
    built = [];
    let shuffled = block;
    for (let i = 0; i < 8 && shuffled.join('\n') === block.join('\n'); i++) {
      shuffled = [...block].sort(() => Math.random() - 0.5);
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
      challenge = await collect(
        streamReply({
          provider: app.mentorProvider,
          key,
          model: app.progress.settings.mentorModel,
          system: forgePrompt(context),
          messages: [{ role: 'user', content: 'Write the challenge.' }],
        }),
      );
      // An empty forge is not worth showing a blank card for; take the day's stored
      // teach-back question instead and carry on.
      if (!challenge) throw new Error('The model sent nothing back.');
    } catch (err) {
      if (err instanceof ModelGoneError) await app.retireModel(app.progress.settings.mentorModel);
      error = err instanceof Error ? err.message : 'Could not write a challenge.';
    } finally {
      loading = false;
    }
  }

  const prompt = $derived(
    card?.kind === 'forge' ? challenge : (context?.day.teachBack ?? ''),
  );

  async function submit() {
    const text = answer.trim();
    const key = app.mentorKey;
    if (!text || !key || !context || streaming) return;
    streaming = true;
    error = null;
    reply = '';
    const history: ChatMessage[] = [{ role: 'user', content: text }];
    try {
      for await (const chunk of streamReply({
        provider: app.mentorProvider,
        key,
        model: app.progress.settings.mentorModel,
        system:
          card?.kind === 'forge'
            ? reviewGraderPrompt(context, challenge)
            : examinerPrompt(context),
        messages: history,
      })) {
        reply += chunk;
      }
      const ruling = parseVerdict(reply);
      if (ruling) {
        verdict = ruling;
        await settle(ruling === 'solid' ? 'good' : 'again');
      }
    } catch (err) {
      if (err instanceof ModelGoneError) await app.retireModel(app.progress.settings.mentorModel);
      error = err instanceof Error ? err.message : 'The mentor is unavailable.';
    } finally {
      streaming = false;
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
  }

  /** Grade an ungradeable card as a miss rather than letting it silently vanish. */
  async function skip() {
    await settle('again');
    await deal();
  }

  $effect(() => {
    if (app.ready && !card && !seen.size) void deal();
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
      <p class="lbl">Review</p>
      <p class="ctx">
        {#if practice}Practice{:else if remaining > 0}{remaining} due{:else}Nothing due — this one's a bonus{/if}
        {#if app.clearedToday}· {app.clearedToday} cleared today{/if}
      </p>
    </div>
  </header>

  {#if !answerable.length}
    <div class="empty card">
      <h2>Nothing to review yet</h2>
      <p>
        Cards appear once you've finished a day's quiz. Come back after a lesson or two
        and this fills up on its own.
      </p>
      <Button size="sm" onclick={() => router.go('/today')}>Back to today</Button>
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
        <Button size="sm" onclick={() => { practice = true; seen = new Set(); void deal(); }}>
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
        {:else if card.kind === 'explain'}explain it
        {:else if card.kind === 'parsons'}rebuild it
        {:else}fresh challenge{/if}
      </span>
    </p>

    {#if loading}
      <div class="card wait"><span class="dot"></span> Writing you a challenge…</div>
    {:else if card.kind === 'quiz' && question}
      <div class="card">
        <h2 class="q">{question.prompt}</h2>
        <div class="options">
          {#each question.options as option, i}
            <button
              class="option"
              class:right={answered && option.correct}
              class:wrong={picked === i && !option.correct}
              disabled={picked !== null}
              onclick={() => void choose(i)}
            >
              <span class="text">{option.text}</span>
              {#if answered && option.correct}<span class="mark">✓</span>{/if}
              {#if picked === i && !option.correct}<span class="mark">✗</span>{/if}
            </button>
            {#if answered && (picked === i || option.correct)}
              <p class="why" class:muted={picked !== i}>{option.why}</p>
            {/if}
          {/each}
        </div>
      </div>
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
                >{@html highlight(line, 'cpp')}</code>
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
                <code>{@html highlight(line, 'cpp')}</code>
              </button>
            {/each}
          </div>
        {/if}

        {#if checked && !parsonsRight}
          <p class="sub">The order it actually runs in:</p>
          <ol class="built shown">
            {#each solution as line}
              <li><code>{@html highlight(line, 'cpp')}</code></li>
            {/each}
          </ol>
        {/if}
      </div>
    {:else if graded}
      <div class="card">
        {#if prompt}
          <div class="q"><Markdown source={prompt} /></div>
        {:else}
          <p class="q">This card needs the mentor, and it isn't reachable right now.</p>
        {/if}
      </div>

      {#if prompt && !verdict}
        <div class="answer">
          <CodeArea
            bind:value={answer}
            bind:codeMode
            placeholder="From memory — no looking it up…"
            ariaLabel="Your answer"
            maxHeight={180}
            onsubmit={() => void submit()}
          />
        </div>
      {/if}

      {#if reply}
        <div class="card grade" class:solid={verdict === 'solid'} class:gaps={verdict === 'gaps'}>
          <Markdown source={stripVerdict(reply)} />
          {#if streaming}<span class="caret"></span>{/if}
        </div>
      {/if}
    {/if}

    {#if error}
      <div class="err">
        <p>{error}</p>
        <button class="link" onclick={() => void skip()}>Skip this card</button>
      </div>
    {/if}

    <div class="actions">
      {#if answered}
        <Button onclick={() => void deal()}>Next card</Button>
        <Button variant="ghost" size="sm" onclick={() => router.go('/today')}>Done for now</Button>
      {:else if card.kind === 'parsons'}
        <Button onclick={() => void checkParsons()} disabled={built.length !== solution.length}>
          Check
        </Button>
        <Button variant="ghost" size="sm" onclick={() => void skip()}>Skip</Button>
      {:else if graded && prompt}
        <Button onclick={() => void submit()} disabled={!answer.trim() || streaming}>
          {streaming ? 'Marking…' : 'Submit'}
        </Button>
        <Button variant="ghost" size="sm" onclick={() => void skip()}>No idea — show me</Button>
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
</style>
