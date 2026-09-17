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

  const anyAnswered = $derived(questions.some((qq) => qq.id in answers));

  /**
   * Answering the same five questions again, days later and with no theory on screen,
   * is retrieval practice — the cheapest thing in the app and one of the few study
   * techniques with strong evidence behind it. So it's one tap, not a reset buried in
   * settings, and it costs nothing: the day stays finished and a clean sweep stays won.
   */
  async function retake() {
    await app.retakeQuiz(day, weekId);
    index = 0;
    scrollTo({ top: 0 });
  }

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
  <div class="head">
    <p class="eyebrow">Question {index + 1} of {questions.length}</p>
    {#if anyAnswered}
      <button class="retake" onclick={retake}>
        <svg viewBox="0 0 24 24"
          ><path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6" /></svg
        >
        Retake
      </button>
    {/if}
  </div>
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
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .retake {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    margin: -4px -5px -4px 0;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-faint);
  }

  .retake:active {
    background: var(--surface-2);
  }

  .retake svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  h1 {
    font-size: 21px;
    line-height: 1.35;
    letter-spacing: -0.015em;
    margin: 5px 0 20px;
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

</style>
