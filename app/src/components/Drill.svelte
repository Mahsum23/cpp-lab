<script lang="ts">
  /**
   * The half of a day's practice that needs no machine.
   *
   * Same interaction as the quiz — prompt, two to four options, one tap, then every
   * option explained — because that interaction already works with one thumb on a train.
   * What a drill adds is a listing to reason about: you are predicting what a program
   * prints, or finding the line that is wrong, rather than recalling a sentence.
   *
   * Every expected output in these was produced by really running the code, which is the
   * only reason it is honest to mark an answer wrong.
   */
  import type { Day, DrillStep } from '../lib/types';
  import { DRILL_KINDS } from '../lib/types';
  import { app } from '../lib/app.svelte';
  import { highlight } from '../lib/markdown';
  import Button from './Button.svelte';

  interface Props {
    day: Day;
    weekId: string;
    lang: string;
    /** Called once the last step has been answered and acknowledged. */
    ondone: () => void;
  }
  let { day, weekId, lang, ondone }: Props = $props();

  const steps = $derived((day.drill ?? []) as DrillStep[]);
  const answers = $derived(app.dayProgress(day.id, weekId).drill.answers);

  // Resume where it was left off. Computed once, like the quiz's: as a reactive
  // expression it re-fires the instant an answer lands and skips the explanation.
  const startAt = (() => {
    const seen = app.dayProgress(day.id, weekId).drill.answers;
    const open = (day.drill ?? []).findIndex((q) => !(q.id in seen));
    return open === -1 ? Math.max((day.drill?.length ?? 1) - 1, 0) : open;
  })();
  let index = $state(startAt);

  const step = $derived(steps[index]);
  const picked = $derived(step ? answers[step.id] : undefined);
  const answered = $derived(picked !== undefined);
  const correctIndex = $derived(step ? step.options.findIndex((o) => o.correct) : -1);
  const gotIt = $derived(answered && picked === correctIndex);
  const last = $derived(index === steps.length - 1);
  const anyAnswered = $derived(steps.some((s) => s.id in answers));

  function choose(i: number) {
    if (answered || !step) return;
    void app.answerDrill(day, weekId, step.id, i);
  }

  function next() {
    if (last) {
      void app.finishDrill(day, weekId);
      ondone();
    } else {
      index += 1;
      scrollTo({ top: 0 });
    }
  }

  async function retake() {
    await app.retakeDrill(day, weekId);
    index = 0;
    scrollTo({ top: 0 });
  }
</script>

{#if step}
  <div class="head">
    <p class="eyebrow">{DRILL_KINDS[step.kind]} · {index + 1} of {steps.length}</p>
    {#if anyAnswered}
      <button class="retake" onclick={retake}>
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6" /></svg>
        Retake
      </button>
    {/if}
  </div>

  {#if step.code}
    <pre class="code"><code class="hljs language-{lang}">{@html highlight(step.code, lang)}</code></pre>
  {/if}

  <h2 class="prompt">{step.prompt}</h2>

  <ul class="options">
    {#each step.options as option, i}
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
        <div class="why bad">
          <p class="lbl">Why that one's wrong</p>
          <p>{step.options[picked!].why}</p>
        </div>
      {/if}
      <div class="why ok">
        <p class="lbl">{gotIt ? 'Right — and here’s the whole of it' : 'The answer'}</p>
        <p>{step.options[correctIndex].why}</p>
      </div>
    </div>

    <div class="cta">
      <Button full onclick={next}>
        {last ? 'Done — show me the lab task' : 'Next'}
        <svg class="arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
      </Button>
    </div>
  {/if}
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

  .prompt {
    font-size: 17.5px;
    line-height: 1.4;
    letter-spacing: -0.01em;
    margin: 14px 0 16px;
  }

  /* The listing is the exercise, so it gets room and its own scroll rather than
     wrapping — a wrapped line changes what the program looks like it does. */
  pre.code {
    margin: 10px 0 0;
    overflow-x: auto;
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
</style>
