<script lang="ts">
  interface Props {
    count: number;
    atRisk?: boolean;
    size?: number;
  }
  let { count, atRisk = false, size = 20 }: Props = $props();
</script>

<span class="flame" class:cold={count === 0} class:risk={atRisk} style:--s="{size}px">
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2c.6 3.2-1.3 4.6-2.7 6C7.6 9.6 6 11.2 6 14a6 6 0 0 0 12 0c0-2.3-1-3.9-2.2-5.4-.5 1-1.2 1.6-2 1.8.7-2.6-.3-6.2-1.8-8.4Z"
    />
  </svg>
  <span class="numeral">{count}</span>
</span>

<style>
  .flame {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--flame);
    font-size: calc(var(--s) * 0.8);
  }

  svg {
    width: var(--s);
    height: var(--s);
    fill: currentColor;
  }

  /* Zero isn't a failure state, it's just Tuesday. Grey it out, don't alarm. */
  .cold {
    color: var(--text-faint);
  }

  .risk svg {
    animation: pulse 2.6s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
</style>
