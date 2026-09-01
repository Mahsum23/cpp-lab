<script lang="ts">
  import type { Day } from '../../lib/types';
  import { app } from '../../lib/app.svelte';
  import Markdown from '../../components/Markdown.svelte';
  import Button from '../../components/Button.svelte';

  interface Props {
    day: Day;
    weekId: string;
    hasQuiz: boolean;
    onnext: () => void;
  }
  let { day, weekId, hasQuiz, onnext }: Props = $props();

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

<style>
  h1 {
    font-size: 26px;
    letter-spacing: -0.025em;
    margin: 4px 0 20px;
  }

  .cta {
    margin-top: 30px;
    padding-top: 22px;
    border-top: 1px solid var(--border);
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
