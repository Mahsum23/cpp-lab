<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { router, sessionPath } from '../lib/router.svelte';
  import Theory from './steps/Theory.svelte';
  import Quiz from './steps/Quiz.svelte';
  import Task from './steps/Task.svelte';
  import TeachBack from './steps/TeachBack.svelte';
  import Celebration from '../components/Celebration.svelte';

  interface Props {
    weekId: string;
    dayId: string;
    step: number;
  }
  let { weekId, dayId, step }: Props = $props();

  const found = $derived(app.findDay(weekId, dayId));
  const day = $derived(found?.day ?? null);
  const hasQuiz = $derived(Boolean(day?.quiz?.length));
  // The teach-back is a step, not an afterthought on the task screen — but only on
  // days that actually pose a question, so a day without one still ends on the task.
  const hasTeachBack = $derived(Boolean(day?.teachBack));

  let celebrating = $state(false);

  const steps = $derived(hasTeachBack ? 4 : 3);
  const clamped = $derived(Math.min(Math.max(step, 0), steps - 1));

  /**
   * The stepper is a switcher, not just a progress bar.
   *
   * Re-reading the theory after the quiz, or jumping straight back to the task, used
   * to mean walking backwards through every step in between — the Back button was the
   * only way through. Step indices are fixed (theory, quiz, task, explain) so a day
   * without a quiz keeps the same numbering and simply doesn't offer that chip.
   */
  const chips = $derived(
    [
      { at: 0, label: 'Theory' },
      ...(hasQuiz ? [{ at: 1, label: 'Quiz' }] : []),
      { at: 2, label: 'Task' },
      ...(hasTeachBack ? [{ at: 3, label: 'Explain' }] : []),
    ].filter((c) => c.at < steps),
  );

  /** Which arcs are closed, so a chip can show what's already done. */
  const done = $derived(day ? app.segments(day, weekId) : []);

  function goto(next: number) {
    if (next < 0) return router.back();
    if (next > steps - 1) return;
    router.replace(sessionPath(weekId, dayId, next));
  }

  async function finish() {
    if (!day) return;
    await app.completeDay(day, weekId);
    celebrating = true;
  }

  function closeCelebration() {
    celebrating = false;
    app.clearCelebration();
    router.go('/today');
  }
</script>

{#if !day || day.status !== 'available'}
  <div class="screen missing">
    <p>That day isn't written yet.</p>
    <button onclick={() => router.go('/today')}>Back to today</button>
  </div>
{:else}
  <div class="stepper">
    <div class="bar" style:--pct="{((clamped + 1) / steps) * 100}%">
      <span></span>
    </div>
    <div class="row">
      <button class="back" onclick={() => router.go('/today')} aria-label="Leave the session">
        <svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
        <span>Day {day.day}</span>
      </button>
      <nav class="chips" aria-label="Session steps">
        {#each chips as chip}
          <button
            class:on={clamped === chip.at}
            class:done={done[chip.at] && clamped !== chip.at}
            aria-current={clamped === chip.at ? 'step' : undefined}
            onclick={() => goto(chip.at)}
          >
            {chip.label}
          </button>
        {/each}
      </nav>
    </div>
  </div>

  <div class="screen player">
    {#if clamped === 0}
      <Theory {day} {weekId} onnext={() => goto(hasQuiz ? 1 : 2)} {hasQuiz} />
    {:else if clamped === 1}
      <Quiz {day} {weekId} onnext={() => goto(2)} />
    {:else if clamped === 2}
      <Task {day} {weekId} onfinish={() => (hasTeachBack ? goto(3) : finish())} />
    {:else}
      <TeachBack {day} week={found!.week} {weekId} onfinish={finish} />
    {/if}
  </div>

  <Celebration open={celebrating} dayTitle={day.title} onclose={closeCelebration} />
{/if}

<style>

  /* Tappable, because moving between steps is something you do constantly and
     walking back through the quiz to re-read a paragraph is absurd. */
  .chips {
    display: flex;
    gap: 4px;
    flex: none;
  }

  .chips button {
    padding: 5px 10px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-faint);
    white-space: nowrap;
  }

  .chips button.done {
    color: var(--ok);
  }

  .chips button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .stepper {
    position: sticky;
    top: 0;
    z-index: 15;
    padding-top: var(--safe-t);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--border);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 620px;
    margin: 0 auto;
    padding: 8px 12px 10px;
  }

  .back {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--text-dim);
    font-size: 15px;
    font-weight: 600;
    margin-left: -4px;
  }

  .back svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }


  .bar {
    height: 3px;
    background: var(--surface-2);
  }

  .bar span {
    display: block;
    height: 100%;
    width: var(--pct);
    background: var(--accent);
    transition: width 0.35s cubic-bezier(0.2, 0.9, 0.25, 1);
  }

  .player {
    padding-top: 18px;
  }

  .missing {
    text-align: center;
    padding-top: 80px;
    color: var(--text-dim);
  }

  .missing button {
    color: var(--accent);
    font-weight: 600;
    margin-top: 8px;
  }
</style>
