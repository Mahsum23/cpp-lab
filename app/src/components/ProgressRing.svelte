<script lang="ts">
  /** The day ring: theory, quiz, task, and — where the day poses one — the
   *  teach-back. Closing it is the unit of
   *  daily progress, so it's deliberately the most animated thing on the screen. */
  interface Props {
    segments: boolean[];
    size?: number;
    labels?: string[];
  }

  let { segments, size = 62, labels = ['theory', 'quiz', 'task', 'teach-back'] }: Props = $props();

  const R = 17;
  const C = 2 * Math.PI * R;
  const GAP = 7;
  const seg = C / 3 - GAP;
  const done = $derived(segments.filter(Boolean).length);
</script>

<div class="ring" style:width="{size}px" style:height="{size}px">
  <svg viewBox="0 0 40 40" aria-hidden="true">
    {#each segments as filled, i}
      <circle
        class="track"
        cx="20"
        cy="20"
        r={R}
        stroke-dasharray="{seg} {C - seg}"
        stroke-dashoffset={-((i * C) / 3)}
      />
      <circle
        class="fill"
        class:on={filled}
        cx="20"
        cy="20"
        r={R}
        stroke-dasharray="{seg} {C - seg}"
        stroke-dashoffset={-((i * C) / 3)}
      />
    {/each}
  </svg>
  <span class="count numeral" style:font-size="{size * 0.29}px">{done}<em>/3</em></span>
</div>
<span class="sr">{done} of 3 steps done: {labels.join(', ')}</span>

<style>
  .ring {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
  }

  svg {
    width: 100%;
    height: 100%;
    /* Start the first segment at 12 o'clock, not 3. */
    transform: rotate(-90deg);
  }

  circle {
    fill: none;
    stroke-width: 3.5;
    stroke-linecap: round;
  }

  .track {
    stroke: var(--border);
  }

  .fill {
    stroke: var(--accent);
    opacity: 0;
    transition:
      opacity 0.35s ease,
      stroke-width 0.35s ease;
  }

  .fill.on {
    opacity: 1;
  }

  .count {
    position: absolute;
    color: var(--text);
  }

  .count em {
    font-style: normal;
    color: var(--text-faint);
    font-size: 0.7em;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
