<script lang="ts">
  import type { Day } from '../../lib/types';
  import { app } from '../../lib/app.svelte';
  import Button from '../../components/Button.svelte';

  interface Props {
    day: Day;
    weekId: string;
    onnext: () => void;
  }
  let { day, weekId, onnext }: Props = $props();

  const questions = $derived(day.quiz ?? []);
  const answers = $derived(app.dayProgress(day.id, weekId).quiz.answers);

  // Resume where he left off rather than replaying answered questions. Computed
  // once, deliberately: as a reactive effect this re-fires the instant he taps an
  // answer and skips him straight past the explanation, which is the entire point
  // of the quiz.
  const startAt = (() => {
    const seen = app.dayProgress(day.id, weekId).quiz.answers;
    const open = (day.quiz ?? []).findIndex((q) => !(q.id in seen));
    return open === -1 ? Math.max((day.quiz?.length ?? 1) - 1, 0) : open;
  })();
  let index = $state(startAt);

  const q = $derived(questions[index]);
  const picked = $derived(q ? answers[q.id] : undefined);
  const answered = $derived(picked !== undefined);
  const correctIndex = $derived(q ? q.options.findIndex((o) => o.correct) : -1);
  const gotIt = $derived(answered && picked === correctIndex);
  const last = $derived(index === questions.length - 1);

  function choose(i: number) {
    if (answered || !q) return;
    void app.answerQuiz(day, weekId, q.id, i);
  }

  function next() {
    if (last) {
      void app.finishQuiz(day, weekId);
      onnext();
    } else {
      index += 1;
      // The explanation leaves the page scrolled; the next prompt starts at the top.
      scrollTo({ top: 0 });
    }
  }
</script>

{#if q}
  <p class="eyebrow">Question {index + 1} of {questions.length}</p>
  <h1>{q.prompt}</h1>

  <ul class="options">
    {#each q.options as option, i}
      <li>
        <button
          class="option"
          class:picked={picked === i}
          class:correct={answered && i === correctIndex}
          class:wrong={answered && picked === i && i !== correctIndex}
          class:dim={answered && picked !== i && i !== correctIndex}
          disabled={answered}
          onclick={() => choose(i)}
        >
          <span class="mark" aria-hidden="true">
            {#if answered && i === correctIndex}
              <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
            {:else if answered && picked === i}
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
            {/if}
          </span>
          <span class="text">{option.text}</span>
        </button>
      </li>
    {/each}
  </ul>

  {#if answered}
    <div class="whys">
      {#if !gotIt}
        <!-- His answer first: the misconception is the thing that needs correcting. -->
        <div class="why bad">
          <p class="lbl">Why that one's wrong</p>
          <p>{q.options[picked!].why}</p>
        </div>
      {/if}
      <div class="why ok">
        <p class="lbl">{gotIt ? 'Right — and here’s the whole of it' : 'The answer'}</p>
        <p>{q.options[correctIndex].why}</p>
      </div>
    </div>

    <div class="cta">
      <Button full onclick={next}>
        {last ? 'On to the task' : 'Next question'}
        <svg class="arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
      </Button>
    </div>
  {/if}
{:else}
  <p class="none">No quiz for this day.</p>
  <Button full onclick={onnext}>On to the task</Button>
{/if}

<style>
  h1 {
    font-size: 21px;
    line-height: 1.35;
    letter-spacing: -0.015em;
    margin: 5px 0 20px;
  }

  .options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 9px;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    width: 100%;
    text-align: left;
    padding: 14px 15px;
    border-radius: 14px;
    background: var(--surface);
    border: 1.5px solid var(--border);
    font-size: 15.5px;
    line-height: 1.45;
    transition:
      border-color 0.18s ease,
      background 0.18s ease,
      opacity 0.18s ease;
  }

  .option:active:not(:disabled) {
    background: var(--surface-2);
  }

  .option.correct {
    border-color: var(--ok);
    background: var(--ok-soft);
  }

  .option.wrong {
    border-color: var(--bad);
    background: var(--bad-soft);
  }

  /* Options he didn't pick and weren't right recede, but stay readable — the
     wrong ones are real misconceptions and worth re-reading. */
  .option.dim {
    opacity: 0.5;
  }

  .option:disabled {
    cursor: default;
  }

  .mark {
    flex: none;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    border: 1.5px solid var(--border-strong);
    display: grid;
    place-items: center;
  }

  .correct .mark {
    border-color: var(--ok);
    color: var(--ok);
  }

  .wrong .mark {
    border-color: var(--bad);
    color: var(--bad);
  }

  .mark svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .whys {
    display: grid;
    gap: 10px;
    margin-top: 18px;
    animation: reveal 0.28s ease;
  }

  .why {
    padding: 13px 15px;
    border-radius: 14px;
    font-size: 15px;
    line-height: 1.55;
    background: var(--surface-2);
  }

  .why p {
    margin: 0;
    color: var(--text-dim);
  }

  .why .lbl {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  .why.ok .lbl {
    color: var(--ok);
  }

  .why.bad .lbl {
    color: var(--bad);
  }

  .cta {
    margin-top: 22px;
  }

  .arrow {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .none {
    color: var(--text-dim);
    margin-bottom: 16px;
  }

  @keyframes reveal {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
