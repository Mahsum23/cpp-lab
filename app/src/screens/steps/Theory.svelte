<script lang="ts">
  import type { Day } from '../../lib/types';
  import { app } from '../../lib/app.svelte';
  import Markdown from '../../components/Markdown.svelte';
  import Button from '../../components/Button.svelte';
  import MentorSheet from '../../components/MentorSheet.svelte';

  interface Props {
    day: Day;
    weekId: string;
    hasQuiz: boolean;
    onnext: () => void;
  }
  let { day, weekId, hasQuiz, onnext }: Props = $props();

  let asking = $state(false);
  const week = $derived(app.findDay(weekId, day.id)?.week ?? null);

  // Openers worth a tap while reading, rather than a blank box. Deliberately about
  // understanding the material — the mentor won't write the task, and these shouldn't
  // suggest otherwise.
  const suggestions = $derived([
    `Explain ${day.title.toLowerCase()} a different way`,
    'What do people most often get wrong here?',
    'Why is it designed like this?',
  ]);

  function next() {
    void app.markTheoryDone(day, weekId);
    onnext();
  }
</script>

<p class="eyebrow">Theory</p>
<h1>{day.title}</h1>

<Markdown source={day.theoryMarkdown} />

<div class="cta">
  <Button full onclick={next}>
    {hasQuiz ? 'Take the quiz' : 'On to the task'}
    <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
  </Button>
</div>

<!-- Floating, because the question usually arrives mid-paragraph rather than at the
     end of one — theory pages are long and this has to stay in reach while scrolling. -->
<button class="ask" onclick={() => (asking = true)} aria-label="Ask the mentor">
  <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5.5A8 8 0 1 1 21 12z" /></svg>
  <span>Ask</span>
</button>

{#if week}
  <MentorSheet {week} {day} open={asking} onclose={() => (asking = false)} {suggestions} />
{/if}

<style>
  h1 {
    font-size: 26px;
    letter-spacing: -0.025em;
    margin: 4px 0 20px;
  }

  .cta {
    margin-top: 30px;
    padding-top: 22px;
    /* Clears the floating Ask pill, which is fixed over this corner. */
    margin-bottom: 78px;
    border-top: 1px solid var(--border);
  }

  .ask {
    position: fixed;
    right: 16px;
    bottom: calc(var(--safe-b) + 18px);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 15px 10px 13px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 14.5px;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  }

  .ask svg {
    width: 17px;
    height: 17px;
  }

  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
